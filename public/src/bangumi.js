(function () {
  const config = window.bgmConfig || { apiUrl: '', quote: '' }
  const API = (config.apiUrl || window.location.origin).replace(/\/$/, '')
  const container = document.querySelector('.bgm-container')
  if (!container) return

  const TYPE_NAMES = { want: '想看', watched: '看过', watching: '在看', on_hold: '搁置', dropped: '抛弃' }

  // 顶部视图切换：番组计划（收藏列表） / 放送日历（/api/calendar） / 动画同步
  const VIEWS = [
    { key: 'collection', label: '番组计划' },
    { key: 'calendar', label: '放送日历' },
    { key: 'sync', label: '动画同步' },
  ]

  // ---------------------------------------------------------------
  // NSFW 年龄确认（保持原逻辑不变）
  // ---------------------------------------------------------------
  async function checkNSFW() {
    try {
      const res = await fetch(API + '/api/config?key=nsfw')
      const data = await res.json()
      if (data.nsfw && !sessionStorage.getItem('bgm-age-confirmed')) {
        document.getElementById('bgm-age-modal').style.display = 'block'
      } else if (!data.nsfw) {
        sessionStorage.removeItem('bgm-age-confirmed')
      }
    } catch (e) {}
  }

  window.bgmConfirmAge = function () {
    sessionStorage.setItem('bgm-age-confirmed', '1')
    document.getElementById('bgm-age-modal').style.display = 'none'
  }

  window.bgmLeaveAge = function () {
    window.location.href = 'https://www.google.com'
  }

  // ---------------------------------------------------------------
  // 收藏卡片（保持原逻辑不变）：用 images.hash 走 worker 图片代理 + 观看进度
  // ---------------------------------------------------------------
  function renderCard(entry) {
    const imgUrl = entry.images && entry.images.hash
      ? API + '/image/' + entry.images.hash + '?w=300&fmt=webp&size=common'
      : 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" fill="#333"><rect width="300" height="400"/></svg>')

    const total = entry.eps || entry.total_episodes || 0
    const progress = total > 0
      ? Math.round((entry.ep_status / total) * 100)
      : 0

    var html = '<a href="https://bgm.tv/subject/' + entry.subject_id + '" target="_blank" class="bgm-card';
    if (entry.nsfw) html += ' bgm-nsfw';
    html += '">' +
      '<div class="bgm-card-cover">' +
        '<img src="' + imgUrl + '" alt="' + (entry.name_cn || entry.name) + '" loading="lazy">';
    if (entry.nsfw) html += '<div class="bgm-nsfw-overlay" onclick="event.preventDefault();this.parentElement.parentElement.classList.toggle(\'bgm-nsfw-reveal\')">R18</div>';
    html += '</div>' +
      '<div class="bgm-card-info">' +
        '<h3>' + (entry.name_cn || entry.name) + '</h3>';
    if (progress > 0) html += '<div class="bgm-progress"><span style="width:' + progress + '%"></span></div>';
    html += '<span class="bgm-ep">' + entry.ep_status + '/' + ((entry.eps || entry.total_episodes || '??')) + '</span>' +
      '</div>' +
    '</a>';
    return html;
  }

  // ---------------------------------------------------------------
  // 放送日历卡片（新增）：items 是 BgmSlimSubject
  // 字段与收藏不同：用 id、images.common（bgm.tv 原图）、rating.score
  // ---------------------------------------------------------------
  function renderCalendarCard(entry) {
    const hasHash = entry.images && entry.images.hash
    const imgUrl = hasHash
      ? API + '/image/' + entry.images.hash + '?w=300&fmt=webp&size=common'
      : 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" fill="#333"><rect width="300" height="400"/></svg>')
    const name = entry.name_cn || entry.name || ''
    const score = entry.rating && entry.rating.score

    var html = '<a href="https://bgm.tv/subject/' + entry.id + '" target="_blank" class="bgm-card';
    if (entry.nsfw) html += ' bgm-nsfw';
    html += '">' +
      '<div class="bgm-card-cover">' +
        '<img src="' + imgUrl + '" alt="' + name + '" width="300" height="400" loading="lazy">';
    if (entry.nsfw) html += '<div class="bgm-nsfw-overlay" onclick="event.preventDefault();this.parentElement.parentElement.classList.toggle(\'bgm-nsfw-reveal\')">R18</div>';
    html += '</div>' +
      '<div class="bgm-card-info">' +
        '<h3>' + name + '</h3>';
    if (score) html += '<span class="bgm-score">★ ' + Number(score).toFixed(1) + '</span>';
    html += '<span class="bgm-ep">' + ((entry.eps || entry.total_episodes) || '??') + ' 话</span>' +
      '</div>' +
    '</a>';
    return html;
  }

  // ---------------------------------------------------------------
  // 收藏视图（原 render 逻辑，封装进一个容器）
  // ---------------------------------------------------------------
  function buildCollectionView() {
    var view = document.createElement('div')
    view.className = 'bgm-view bgm-view-collection'

    var nav = document.createElement('div')
    nav.className = 'bgm-nav'
    var keys = Object.keys(TYPE_NAMES)
    var navHtml = ''
    for (var i = 0; i < keys.length; i++) {
      var navActive = keys[i] === 'watching' ? ' class="active"' : ''
      navHtml += '<button data-type="' + keys[i] + '"' + navActive + '>' + TYPE_NAMES[keys[i]] + '</button>'
    }
    nav.innerHTML = navHtml
    view.appendChild(nav)

    var grid = document.createElement('div')
    grid.className = 'bgm-grid'
    view.appendChild(grid)

    var pagination = document.createElement('div')
    pagination.className = 'bgm-pagination'
    view.appendChild(pagination)

    var currentType = 'watching'
    var currentPage = 1
    var loaded = false

    async function load(type, page) {
      try {
        var res = await fetch(API + '/api/collections?type=' + type + '&page=' + page + '&limit=24')
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText)
        var data = await res.json()
        if (data.total === 0) {
          grid.innerHTML = '<p class="bgm-empty">暂无数据 — 同步可能尚未执行，请在动画同步视图配置 token 并触发同步</p>'
          pagination.innerHTML = ''
          return
        }
        var cardsHtml = ''
        for (var i = 0; i < data.data.length; i++) {
          cardsHtml += renderCard(data.data[i])
        }
        grid.innerHTML = cardsHtml

        var totalPages = Math.ceil(data.total / 24)
        pagination.innerHTML = ''
        for (var i = 1; i <= totalPages; i++) {
          var btn = document.createElement('button')
          btn.textContent = i
          if (i === page) btn.classList.add('active')
          ;(function(p) { btn.onclick = function() { currentPage = p; load(currentType, p) } })(i)
          pagination.appendChild(btn)
        }
      } catch (e) {
        grid.innerHTML = '<p class="bgm-error">加载失败: ' + (e.message || '未知错误') + '<br><small>API: ' + API + '</small></p>'
      }
    }

    nav.addEventListener('click', function(e) {
      if (e.target.tagName === 'BUTTON') {
        var navBtns = nav.querySelectorAll('button')
        for (var n = 0; n < navBtns.length; n++) {
          navBtns[n].classList.toggle('active', navBtns[n] === e.target)
        }
        currentType = e.target.dataset.type
        currentPage = 1
        load(currentType, 1)
      }
    })

    return {
      el: view,
      // 首次切换到该视图时再加载（含健康检查）
      async activate() {
        if (loaded) return
        loaded = true
        var statusBar = document.createElement('div')
        statusBar.className = 'bgm-status'
        statusBar.innerHTML = '<p>正在连接...</p>'
        view.insertBefore(statusBar, nav)
        try {
          var healthRes = await fetch(API + '/api/health')
          var health = await healthRes.json()
          if (health.ok && health.data && health.data.collections) {
            var c = health.data.collections
            statusBar.innerHTML = '<p>已连接 | 条目 ' + (c.types && c.types._total) + ' | 更新于 ' + (c.updated_at || '?').slice(0, 10) + '</p>'
          } else if (health.ok) {
            var hint = '请在动画同步视图配置 token 并触发同步'
            if (health.data && health.data.last_error) hint += '<br>上次同步错误: ' + health.data.last_error
            statusBar.innerHTML = '<p class="bgm-status-warn">已连接，但 KV 无数据。' + hint + '</p>'
          } else {
            statusBar.innerHTML = '<p class="bgm-status-warn">健康检查失败: ' + (health.error || '') + '</p>'
          }
        } catch (e) {
          statusBar.innerHTML = '<p class="bgm-status-warn">无法连接 Worker: ' + (e.message || '') + '</p>'
        }
        setTimeout(function () { statusBar.style.opacity = '0.4' }, 3000)
        load(currentType, 1)
      },
    }
  }

  // ---------------------------------------------------------------
  // 放送日历视图（新增）：fetch /api/calendar，按星期分组渲染
  // ---------------------------------------------------------------
  function buildCalendarView() {
    var view = document.createElement('div')
    view.className = 'bgm-view bgm-view-calendar'

    var cal = document.createElement('div')
    cal.className = 'bgm-calendar'
    view.appendChild(cal)

    var loaded = false
    // bgm.tv weekday.id: 1=周一 ... 7=周日；JS getDay(): 0=周日
    var todayId = (new Date().getDay() === 0) ? 7 : new Date().getDay()

    function renderCalendar(days) {
      if (!days || !days.length) {
        cal.innerHTML = '<p class="bgm-empty">暂无日历数据 — 同步可能尚未执行，请在动画同步视图配置 token 并触发同步</p>'
        return
      }
      var html = ''
      for (var i = 0; i < days.length; i++) {
        var day = days[i]
        var wd = day.weekday || {}
        var items = day.items || []
        var isToday = wd.id === todayId
        html += '<section class="bgm-weekday' + (isToday ? ' is-today' : '') + '">'
        html += '<div class="bgm-weekday-head">' +
          '<span class="cn">' + (wd.cn || '') + '</span>' +
          '<span class="en">' + (wd.en || '') + '</span>' +
          '<span class="count">' + items.length + '</span>' +
        '</div>'
        html += '<div class="bgm-grid">'
        for (var j = 0; j < items.length; j++) {
          html += renderCalendarCard(items[j])
        }
        html += '</div></section>'
      }
      cal.innerHTML = html
    }

    return {
      el: view,
      async activate() {
        if (loaded) return
        loaded = true
        cal.innerHTML = '<p class="bgm-status"><span>正在加载放送日历...</span></p>'
        try {
          var res = await fetch(API + '/api/calendar')
          if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText)
          var days = await res.json()
          renderCalendar(days)
        } catch (e) {
          cal.innerHTML = '<p class="bgm-error">日历加载失败: ' + (e.message || '未知错误') + '<br><small>API: ' + API + '</small></p>'
          loaded = false // 允许下次重试
        }
      },
    }
  }

  // ---------------------------------------------------------------
  // 动画同步视图（多账户对比 + 同步）
  // ---------------------------------------------------------------
  function buildSyncView() {
    var view = document.createElement('div')
    view.className = 'bgm-view bgm-view-sync'

    // ── Token area ──
    var tok = document.createElement('div')
    tok.className = 'sync-token-area'
    tok.innerHTML = '<h3>多账户动画同步</h3>' +
      '<p class="muted" style="font-size:12px;margin-bottom:8px;">粘贴 <a href="https://bgm.tv/dev" target="_blank">bgm.tv Access Token</a>，两个账号各一个；仅同步动画收藏</p>'
    view.appendChild(tok)

    function buildTokenRow(side, idSuffix) {
      var row = document.createElement('div')
      row.className = 'sync-token-row'
      var saved = sessionStorage.getItem('sync-token' + idSuffix) || ''
      if (saved) {
        row.innerHTML = '<span style="color:#4caf50;font-size:13px;">\u2713 ' + side + ' token 已就绪</span>' +
          ' <button class="sync-token-clear" data-side="' + idSuffix + '" style="font-size:11px;background:none;border:none;color:#e94560;cursor:pointer;text-decoration:underline;">清除</button>'
      } else {
        row.innerHTML = '<div style="display:flex;gap:8px;">' +
          '<label style="flex:1;font-size:12px;color:#a0a0b0;">' + side + ' Token' +
          '<input type="password" class="sync-token-input" data-side="' + idSuffix + '" placeholder="Access Token" style="width:100%;padding:8px;border:1px solid #2a2a4a;border-radius:4px;background:#0f3460;color:#fff;font-size:13px;margin-top:2px;"></label>' +
          '<label style="font-size:12px;color:#a0a0b0;">平台<select class="sync-platform" data-side="' + idSuffix + '" style="margin-top:18px;padding:8px;border:1px solid #2a2a4a;border-radius:4px;background:#0f3460;color:#fff;font-size:13px;"><option value="bgm">bgm.tv</option></select></label>' +
          '</div>'
      }
      return row
    }

    var rowA = buildTokenRow('Account A', 'A')
    var rowB = buildTokenRow('Account B', 'B')
    tok.appendChild(rowA)
    tok.appendChild(rowB)

    var compareBtn = document.createElement('button')
    compareBtn.id = 'sync-compare-btn'
    compareBtn.className = 'bgm-nav-button'
    compareBtn.textContent = '对比收藏'
    compareBtn.style.cssText = 'margin-top:8px;width:100%;'
    tok.appendChild(compareBtn)

    // ── Result area ──
    var resultArea = document.createElement('div')
    resultArea.id = 'sync-result'
    view.appendChild(resultArea)

    var loaded = false
    var syncState = { tokenA: '', tokenB: '', data: null, page: 1, filter: 'all', search: '' }

    // ── Token clear handler ──
    tok.addEventListener('click', function(e) {
      if (e.target.classList.contains('sync-token-clear')) {
        var side = e.target.dataset.side
        sessionStorage.removeItem('sync-token' + side)
        var row = e.target.closest('.sync-token-row')
        var newRow = buildTokenRow(side === 'A' ? 'Account A' : 'Account B', side)
        row.parentNode.replaceChild(newRow, row)
      }
    })

    // ── Card renderer ──
    function renderCards(filter, page, pageSize, search) {
      var data = syncState.data; if (!data) return
      var nameA = (data.userA && data.userA.name) || 'A'
      var nameB = (data.userB && data.userB.name) || 'B'

      var all = []
      function push(d, section) {
        if (search && d.title.toLowerCase().indexOf(search.toLowerCase()) === -1) return
        d._section = section
        d._checkbox = section !== 'same'
        all.push(d)
      }

      if (filter === 'all' || filter === 'diff') {
        ;(data.differences || []).forEach(function(d) { push(d, 'diff') })
      }
      if (filter === 'all' || filter === 'onlyA') {
        ;(data.onlyA || []).forEach(function(d) { push(d, 'onlyA') })
      }
      if (filter === 'all' || filter === 'onlyB') {
        ;(data.onlyB || []).forEach(function(d) { push(d, 'onlyB') })
      }
      if (filter === 'same') {
        ;(data.same || []).forEach(function(d) { push(d, 'same') })
      }

      var tp = Math.ceil(all.length / pageSize) || 1
      var start = (page - 1) * pageSize
      var pageItems = all.slice(start, start + pageSize)

      var h = ''
      h += '<div class="sync-cards">'
      if (!pageItems.length) {
        h += '<p class="bgm-empty" style="padding:20px;text-align:center;">无匹配条目</p>'
      } else {
        pageItems.forEach(function(d) {
          var isDiff = d._section === 'diff'
          var isOnlyA = d._section === 'onlyA'
          var isOnlyB = d._section === 'onlyB'
          var isSame = d._section === 'same'; if (isSame) { d.statusA = d.statusB = d.status; d.progressA = d.progressB = d.progress; d.scoreA = d.scoreB = d.score; }

          var borderColor = ''
          if (isDiff && d.statusA !== d.statusB) borderColor = '#e94560'
          else if (isDiff && d.progressA !== d.progressB) borderColor = '#ff9800'
          else if (isOnlyA || isOnlyB) borderColor = '#4caf50'

          h += '<div class="sync-card" style="' + (borderColor ? 'border-left:4px solid ' + borderColor : '') + '">'

          // Title row
          var highScore = Math.max(d.scoreA || 0, d.scoreB || 0, d.score || 0)
          var highEp = Math.max(d.totalEpisodes || d.progressA || d.progressB || d.progress || 0)
          var titleExtras = ''
          if (highEp > 0 || highScore > 0) {
            titleExtras = '<span style="float:right;font-size:11px;color:#a0a0b0;font-weight:normal;">'
            if (highEp > 0) titleExtras += highEp + '话'
            if (highScore > 0) titleExtras += (highEp > 0 ? ' / ' : '') + '\u2605 ' + highScore
            titleExtras += '</span>'
          }
          var titleName = d.title || d.name_cn || d.name || '#' + (d.externalId || d.subject_id)
          h += '<div class="sync-card-title">' + titleName + titleExtras + '</div>'

          // Side-by-side columns
          h += '<div class="sync-card-cols">'

          // Column A
          h += '<div class="sync-card-col">'
          h += '<div class="sync-col-label">' + nameA + '</div>'
          if (isOnlyB) {
            h += '<div class="sync-col-empty">\u2014</div>'
          } else {
            h += '<span class="sync-badge" style="background:' + statusBadgeColor(d.statusA) + '">' + statusLabel(d.statusA) + '</span>'
            var pctA = (d.totalEpisodes || d.progressA) > 0 ? Math.round(d.progressA / Math.max(d.totalEpisodes || d.progressA, 1) * 100) : 0
            h += '<div class="sync-progress-bar"><span style="width:' + pctA + '%"></span></div>'
            h += '<span class="sync-progress-text">' + d.progressA + '话</span>'
            if (d.scoreA > 0) {
              var arrow = (d.scoreA > d.scoreB) ? ' <span style="color:#e94560;">\u2191</span>' : ''
              h += '<span class="sync-score">\u2605 ' + d.scoreA + arrow + '</span>'
            }
          }
          h += '</div>'

          // Column B
          h += '<div class="sync-card-col">'
          h += '<div class="sync-col-label">' + nameB + '</div>'
          if (isOnlyA) {
            h += '<div class="sync-col-empty">\u2014</div>'
          } else {
            h += '<span class="sync-badge" style="background:' + statusBadgeColor(d.statusB) + '">' + statusLabel(d.statusB) + '</span>'
            var pctB = (d.totalEpisodes || d.progressB) > 0 ? Math.round(d.progressB / Math.max(d.totalEpisodes || d.progressB, 1) * 100) : 0
            h += '<div class="sync-progress-bar"><span style="width:' + pctB + '%"></span></div>'
            h += '<span class="sync-progress-text">' + d.progressB + '话</span>'
            if (d.scoreB > 0) {
              var arrowB = (d.scoreB > d.scoreA) ? ' <span style="color:#e94560;">\u2191</span>' : ''
              h += '<span class="sync-score">\u2605 ' + d.scoreB + arrowB + '</span>'
            }
          }
          h += '</div>'

          h += '</div>' // sync-card-cols

          // Checkbox row
          if (!isSame) {
            var cid = d.externalId || d.subject_id
            h += '<div class="sync-card-check"><label><input type="checkbox" checked data-id="' + cid + '"> \u540c\u6b65\u6b64\u9879</label></div>'
          }

          h += '</div>' // sync-card
        })
      }
      h += '</div>' // sync-cards

      // Pagination
      if (tp > 1) {
        h += '<div class="sync-pagination">'
        var pages = [1]
        for (var p = Math.max(2, page - 2); p <= Math.min(tp - 1, page + 2); p++) pages.push(p)
        pages.push(tp)
        pages.forEach(function(p, i) {
          if (i > 0 && pages[i-1] !== '...' && p - pages[i-1] > 1) h += '<span>...</span>'
          if (p === page) h += '<span class="sync-pg-active">' + p + '</span>'
          else h += '<button class="sync-pg-btn" data-pg="' + p + '">' + p + '</button>'
        })
        h += '</div>'
      }

      resultArea.querySelector('.sync-cards-wrap').innerHTML = h

      // Wire pagination
      resultArea.querySelectorAll('.sync-pg-btn').forEach(function(b) {
        b.addEventListener('click', function() {
          syncState.page = parseInt(this.dataset.pg)
          renderCards(syncState.filter, syncState.page, parseInt(document.getElementById('sync-pagesize').value), syncState.search)
        })
      })
    }

    function renderCompareResult(data) {
      var nameA = (data.userA && data.userA.name) || 'A'
      var nameB = (data.userB && data.userB.name) || 'B'
      var sameLen = (data.same || []).length
      var diffLen = (data.differences || []).length
      var onlyALen = (data.onlyA || []).length
      var onlyBLen = (data.onlyB || []).length
      var allLen = diffLen + onlyALen + onlyBLen

      syncState.data = data
      syncState.filter = 'all'
      syncState.page = 1
      syncState.search = ''

      var h = ''

      // Pill navigation
      h += '<div class="sync-pills">'
      h += '<button class="sync-pill active" data-filter="all">\u5168\u90e8 ' + allLen + '</button>'
      if (diffLen) h += '<button class="sync-pill" data-filter="diff">\u5dee\u5f02 ' + diffLen + '</button>'
      if (onlyALen) h += '<button class="sync-pill" data-filter="onlyA">\u4ec5' + nameA + ' ' + onlyALen + '</button>'
      if (onlyBLen) h += '<button class="sync-pill" data-filter="onlyB">\u4ec5' + nameB + ' ' + onlyBLen + '</button>'
      if (sameLen) h += '<button class="sync-pill" data-filter="same">\u76f8\u540c ' + sameLen + '</button>'
      h += '</div>'

      // Progress bar (top)
      h += '<div id="sync-progress" style="display:none;margin-bottom:12px;"><div class="bgm-progress"><span id="sync-progress-fill" style="width:0%"></span></div>' +
        '<p id="sync-progress-text" class="muted" style="font-size:12px;margin-top:4px;"></p></div>'

      // Toolbar
      h += '<div class="sync-toolbar">'
      h += '<button id="sync-sel-all" class="sync-tool-btn">\u5168\u9009</button>'
      h += '<button id="sync-sel-rev" class="sync-tool-btn">\u53cd\u9009</button>'
      h += '<select id="sync-pagesize" style="padding:4px 6px;font-size:11px;"><option value="20">20/\u9875</option><option value="50">50/\u9875</option><option value="100">100/\u9875</option></select>'
      h += '<input type="text" id="sync-search" placeholder="\u641c\u7d22\u6761\u76ee..." style="padding:4px 8px;font-size:11px;border:1px solid #2a2a4a;border-radius:4px;background:#0f3460;color:#fff;width:140px;">'
      h += '<span style="flex:1;"></span>'
      h += '<select id="sync-direction" style="padding:4px 6px;font-size:11px;">'
      h += '<option value="A->B">' + nameA + ' \u2192 ' + nameB + '</option>'
      h += '<option value="B->A">' + nameB + ' \u2192 ' + nameA + '</option></select>'
      h += '<button id="sync-full-btn" class="sync-tool-btn" style="background:#e94560;color:#fff;">\u5b8c\u6574\u540c\u6b65</button>'
      h += '<button id="sync-sel-btn" class="sync-tool-btn">\u9009\u4e2d\u540c\u6b65</button>'
      h += '</div>'

      // Cards container
      h += '<div class="sync-cards-wrap"></div>'

      resultArea.innerHTML = h

      // Wire events
      resultArea.querySelectorAll('.sync-pill').forEach(function(pill) {
        pill.addEventListener('click', function() {
          resultArea.querySelectorAll('.sync-pill').forEach(function(p) { p.classList.remove('active') })
          this.classList.add('active')
          syncState.filter = this.dataset.filter
          syncState.page = 1
          renderCards(syncState.filter, 1, parseInt(document.getElementById('sync-pagesize').value), syncState.search)
        })
      })

      document.getElementById('sync-pagesize').addEventListener('change', function() {
        syncState.page = 1
        renderCards(syncState.filter, 1, parseInt(this.value), syncState.search)
      })

      document.getElementById('sync-search').addEventListener('input', function() {
        syncState.search = this.value
        syncState.page = 1
        renderCards(syncState.filter, 1, parseInt(document.getElementById('sync-pagesize').value), this.value)
      })

      document.getElementById('sync-sel-all').addEventListener('click', function() {
        resultArea.querySelectorAll('input[type=checkbox]').forEach(function(c) { c.checked = true })
      })
      document.getElementById('sync-sel-rev').addEventListener('click', function() {
        resultArea.querySelectorAll('input[type=checkbox]').forEach(function(c) { c.checked = !c.checked })
      })

      document.getElementById('sync-full-btn').addEventListener('click', function() { doSyncOp('full', []) })
      document.getElementById('sync-sel-btn').addEventListener('click', function() {
        var ids = Array.from(resultArea.querySelectorAll('input[type=checkbox]:checked')).map(function(c) { return c.dataset.id })
        if (!ids.length) return alert('\u8bf7\u81f3\u5c11\u9009\u4e2d\u4e00\u4e2a\u6761\u76ee')
        doSyncOp('partial', ids)
      })

      renderCards('all', 1, 20, '')
    }

    async function doSyncOp(mode, subjectIds) {
      var dir = document.getElementById('sync-direction').value
      var fromToken = dir === 'A->B' ? syncState.tokenA : syncState.tokenB
      var toToken = dir === 'A->B' ? syncState.tokenB : syncState.tokenA
      var nameA = (syncState.data && syncState.data.userA && syncState.data.userA.name) || 'Account A'
      var nameB = (syncState.data && syncState.data.userB && syncState.data.userB.name) || 'Account B'
      var totalA = (syncState.data && syncState.data.userA && syncState.data.userA.total) || 0
      var totalB = (syncState.data && syncState.data.userB && syncState.data.userB.total) || 0
      var fromUser = dir === 'A->B' ? nameA : nameB
      var toUser = dir === 'A->B' ? nameB : nameA
      var expected = mode === 'full' ? (dir === 'A->B' ? totalA : totalB) : subjectIds.length
      var platformA = (resultArea.querySelector('.sync-platform[data-side="A"]') || {}).value || 'bgm'
      var platformB = (resultArea.querySelector('.sync-platform[data-side="B"]') || {}).value || 'bgm'

      document.getElementById('sync-progress').style.display = ''
      document.getElementById('sync-progress-fill').style.width = '0%'
      document.getElementById('sync-progress-text').textContent = '\u6b63\u5728\u540c\u6b65... \u6a21\u5f0f ' + mode + '\uff0c\u9884\u8ba1 ' + expected + ' \u9879'

      try {
        var res = await fetch(API + '/api/sync/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tokenA: fromToken, platformA: platformA, from: fromUser, tokenB: toToken, platformB: platformB, to: toUser, mode: mode, subject_ids: subjectIds }),
        })
        var results = await res.json().catch(function() { return null })
        if (!res.ok) {
          var errMsg = (results && results.error && results.error.message) || ('HTTP ' + res.status + ' ' + res.statusText)
          document.getElementById('sync-progress-fill').style.width = '0%'
          document.getElementById('sync-progress-text').innerHTML = '<span style="color:#e94560;">\u540c\u6b65\u5931\u8d25: ' + errMsg + '</span>'
          return
        }
        if (!Array.isArray(results)) throw new Error('Invalid response')
        var ok = results.filter(function(r) { return r.status === 'ok' }).length
        var err = results.filter(function(r) { return r.status === 'error' }).length
        document.getElementById('sync-progress-fill').style.width = '100%'
        var msg = '\u540c\u6b65\u5b8c\u6210\uff1a' + ok + ' \u6210\u529f\uff0c' + err + ' \u5931\u8d25'
        msg += '<br><small>\u8bf7\u6c42\u6a21\u5f0f: ' + mode + '\uff1b\u9884\u8ba1: ' + expected + '\uff1b\u540e\u7aef\u8fd4\u56de: ' + results.length + '</small>'
        if (err > 0) {
          var failed = results.filter(function(r) { return r.status === 'error' }).slice(0, 3).map(function(r) { return (r.title || r.externalId) + ': ' + (r.error || 'unknown') }).join('; ')
          msg += '<br><small style="color:#e94560;">\u5931\u8d25\u6761\u76ee: ' + failed + (err > 3 ? ' \u7b49' + err + '\u9879' : '') + '</small>'
        }
        document.getElementById('sync-progress-text').innerHTML = msg
      } catch (e) {
        document.getElementById('sync-progress-fill').style.width = '0%'
        document.getElementById('sync-progress-text').innerHTML = '<span style="color:#e94560;">\u540c\u6b65\u5931\u8d25: ' + (e.message || '\u672a\u77e5\u9519\u8bef') + '</span>'
      }
    }

    return {
      el: view,
      activate: function() {
        if (loaded) return
        loaded = true
        compareBtn.addEventListener('click', async function() {
          var inputA = tok.querySelector('.sync-token-input[data-side="A"]')
          var inputB = tok.querySelector('.sync-token-input[data-side="B"]')
          var selA = tok.querySelector('.sync-platform[data-side="A"]')
          var selB = tok.querySelector('.sync-platform[data-side="B"]')
          var ta = inputA ? inputA.value.trim() : ''
          var tb = inputB ? inputB.value.trim() : ''
          if (!ta && sessionStorage.getItem('sync-tokenA')) ta = sessionStorage.getItem('sync-tokenA')
          if (!tb && sessionStorage.getItem('sync-tokenB')) tb = sessionStorage.getItem('sync-tokenB')
          if (!ta || !tb) return alert('\u8bf7\u586b\u5199\u4e24\u4e2a\u8d26\u53f7\u7684 Access Token')

          syncState.tokenA = ta; syncState.tokenB = tb

          resultArea.innerHTML = '<p class="bgm-status">\u6b63\u5728\u52a0\u8f7d\u53cc\u65b9\u6536\u85cf\u6570\u636e...</p>'
          try {
            var platformA = selA ? selA.value : 'bgm'
            var platformB = selB ? selB.value : 'bgm'
            var res = await fetch(API + '/api/sync/compare', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tokenA: ta, platformA: platformA, tokenB: tb, platformB: platformB }),
            })
            var data = await res.json()
            if (!res.ok) throw new Error(data.error || '\u8bf7\u6c42\u5931\u8d25')

            // Save tokens
            sessionStorage.setItem('sync-tokenA', ta)
            sessionStorage.setItem('sync-tokenB', tb)
            // Update token row display
            var rows = tok.querySelectorAll('.sync-token-row')
            if (rows[0]) { var nrA = buildTokenRow('Account A', 'A'); rows[0].parentNode.replaceChild(nrA, rows[0]) }
            if (rows[1]) { var nrB = buildTokenRow('Account B', 'B'); rows[1].parentNode.replaceChild(nrB, rows[1]) }

            renderCompareResult(data)
          } catch (e) {
            resultArea.innerHTML = '<p class="bgm-error">\u5bf9\u6bd4\u5931\u8d25: ' + (e.message || '\u672a\u77e5\u9519\u8bef') + '</p>'
          }
        })
      },
    }
  }
  function statusLabel(s) {
  var map = { watching: '在看', completed: '看过', plan_to_watch: '想看', on_hold: '搁置', dropped: '抛弃' }
  return map[s] || s || '—'
}
function statusBadgeColor(s) {
  return { watching: '#00a1d6', completed: '#4caf50', plan_to_watch: '#9b59b6', on_hold: '#f39c12', dropped: '#e74c3c' }[s] || '#666'
}

  // ---------------------------------------------------------------
  // 顶层：渲染 tab 切换 + 三个视图
  // ---------------------------------------------------------------
  async function render() {
    var collectionView = buildCollectionView()
    var calendarView = buildCalendarView()
    var syncView = buildSyncView()
    var views = { collection: collectionView, calendar: calendarView, sync: syncView }

    var switcher = document.createElement('div')
    switcher.className = 'bgm-view-switch'
    var btnHtml = ''
    for (var i = 0; i < VIEWS.length; i++) {
      btnHtml += '<button data-view="' + VIEWS[i].key + '">' + VIEWS[i].label + '</button>'
    }
    switcher.innerHTML = btnHtml
    container.appendChild(switcher)
    container.appendChild(collectionView.el)
    container.appendChild(calendarView.el)
    container.appendChild(syncView.el)

    function activate(key) {
      var btns = switcher.querySelectorAll('button')
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('active', btns[i].dataset.view === key)
      }
      collectionView.el.style.display = key === 'collection' ? '' : 'none'
      calendarView.el.style.display = key === 'calendar' ? '' : 'none'
      syncView.el.style.display = key === 'sync' ? '' : 'none'
      views[key].activate()
    }

    switcher.addEventListener('click', function (e) {
      if (e.target.tagName === 'BUTTON') activate(e.target.dataset.view)
    })

    await checkNSFW()
    activate('collection')
  }

  render()
})()
