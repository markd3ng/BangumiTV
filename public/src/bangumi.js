(function () {
  const config = window.bgmConfig || { apiUrl: '', quote: '' }
  const API = (config.apiUrl || window.location.origin).replace(/\/$/, '')
  const container = document.querySelector('.bgm-container')
  if (!container) return

  const TYPE_NAMES = { want: '想看', watched: '看过', watching: '在看', on_hold: '搁置', dropped: '抛弃' }

  // 顶部视图切换：番组计划（收藏列表） / 放送日历（/api/calendar） / 条目同步
  const VIEWS = [
    { key: 'collection', label: '番组计划' },
    { key: 'calendar', label: '放送日历' },
    { key: 'sync', label: '条目同步' },
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
          grid.innerHTML = '<p class="bgm-empty">暂无数据 — 同步可能尚未执行，请在 /manage 授权并触发同步</p>'
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
            var hint = '请在 /manage 授权并触发同步'
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
        cal.innerHTML = '<p class="bgm-empty">暂无日历数据 — 同步可能尚未执行，请在 /manage 授权并触发同步</p>'
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
  // 条目同步视图（多账户对比 + 同步）
  // ---------------------------------------------------------------
  function buildSyncView() {
    var view = document.createElement('div')
    view.className = 'bgm-view bgm-view-sync'
    view.style.cssText = 'padding:0;'

    var form = document.createElement('div')
    form.style.cssText = 'margin-bottom:16px;'
    form.innerHTML = '<h3 style="margin-bottom:8px;">多账户条目同步</h3>' +
      '<p class="muted" style="font-size:12px;margin-bottom:12px;">在 <a href="https://bgm.tv/dev" target="_blank">bgm.tv 开发者设置</a> 生成 access token</p>' +
      <div style="display:flex;gap:8px;margin-bottom:8px;">
      <label style="flex:1;display:block;color:#a0a0b0;font-size:12px;">账号 A Token
      <input type="password" id="sync-tokenA" placeholder="Access Token" style="width:100%;padding:8px;border:1px solid #2a2a4a;border-radius:4px;background:#0f3460;color:#fff;font-size:13px;"></label>
      <label style="color:#a0a0b0;font-size:12px;">平台<select id="sync-platformA" style="margin-top:18px;padding:8px;border:1px solid #2a2a4a;border-radius:4px;background:#0f3460;color:#fff;font-size:13px;"><option value="bgm">bgm.tv</option></select></label>
      </div>
      '<input type="password" id="sync-tokenA" placeholder="粘贴账号 A 的 Access Token" style="width:100%;padding:8px;border:1px solid #2a2a4a;border-radius:4px;background:#0f3460;color:#fff;margin-bottom:8px;font-size:13px;">' +
      <div style="display:flex;gap:8px;margin-bottom:8px;">
      <label style="flex:1;display:block;color:#a0a0b0;font-size:12px;">账号 B Token
      <input type="password" id="sync-tokenB" placeholder="Access Token" style="width:100%;padding:8px;border:1px solid #2a2a4a;border-radius:4px;background:#0f3460;color:#fff;font-size:13px;"></label>
      <label style="color:#a0a0b0;font-size:12px;">平台<select id="sync-platformB" style="margin-top:18px;padding:8px;border:1px solid #2a2a4a;border-radius:4px;background:#0f3460;color:#fff;font-size:13px;"><option value="bgm">bgm.tv</option></select></label>
      </div>
      '<input type="password" id="sync-tokenB" placeholder="粘贴账号 B 的 Access Token" style="width:100%;padding:8px;border:1px solid #2a2a4a;border-radius:4px;background:#0f3460;color:#fff;margin-bottom:8px;font-size:13px;">' +
      '<button id="sync-compare-btn" class="bgm-nav-button">对比收藏</button>'
    view.appendChild(form)

    var resultArea = document.createElement('div')
    resultArea.id = 'sync-result'
    view.appendChild(resultArea)

    var loaded = false
    var syncState = { tokenA: '', tokenB: '', data: null, page: 1, filter: 'all' }

    function renderCompareResult(data) {
      var nameA = (data.userA && data.userA.name) || 'A'; var nameB = (data.userB && data.userB.name) || 'B'
      var sameLen = (data.same || []).length; var diffLen = (data.differences || []).length
      var onlyALen = (data.onlyA || []).length; var onlyBLen = (data.onlyB || []).length

      var html = '<div style="display:flex;gap:8px;margin-bottom:8px;font-size:13px;">' +
        '<span style="color:#4caf50;">相同: ' + sameLen + '</span> <span style="color:#e94560;">差异: ' + diffLen + '</span>' +
        '<span>仅' + nameA + ': ' + onlyALen + '</span> <span>仅' + nameB + ': ' + onlyBLen + '</span></div>'

      html += '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">' +
        '<select id="sync-filter" style="padding:6px 8px;font-size:12px;">' +
        '<option value="all">全部差异&独有(' + (diffLen+onlyALen+onlyBLen) + ')</option>' +
        (diffLen ? '<option value="diff">仅差异(' + diffLen + ')</option>' : '') +
        (onlyALen ? '<option value="onlyA">仅' + nameA + '有(' + onlyALen + ')</option>' : '') +
        (onlyBLen ? '<option value="onlyB">仅' + nameB + '有(' + onlyBLen + ')</option>' : '') +
        (sameLen ? '<option value="same">相同(' + sameLen + ')</option>' : '') +
        '</select>' +
        '<button id="sync-sel-all" class="bgm-nav-button" style="font-size:11px;padding:4px 8px;">全选</button>' +
        '<button id="sync-sel-rev" class="bgm-nav-button" style="font-size:11px;padding:4px 8px;">反选</button>' +
        '<select id="sync-pagesize" style="padding:6px 8px;font-size:12px;margin-left:auto;">' +
        '<option value="20">20/页</option><option value="50">50/页</option><option value="100">100/页</option></select></div>'

      html += '<div id="sync-table"></div>'

      html += '<div style="margin-top:16px;border-top:1px solid #2a2a4a;padding-top:12px;">' +
        '<label style="font-size:12px;">同步方向</label>' +
        '<select id="sync-direction" style="margin:4px 0 8px;padding:6px 8px;font-size:12px;">' +
        '<option value="A->B">' + nameA + ' → ' + nameB + '</option>' +
        '<option value="B->A">' + nameB + ' → ' + nameA + '</option></select>' +
        '<div style="display:flex;gap:8px;">' +
        '<button id="sync-full-btn" class="bgm-nav-button">完整同步</button>' +
        '<button id="sync-sel-btn" class="bgm-nav-button" style="font-size:11px;">按选中条目同步</button></div>' +
        '<div id="sync-progress" style="display:none;margin-top:8px;"><div class="bgm-progress"><span id="sync-progress-fill" style="width:0%"></span></div>' +
        '<p id="sync-progress-text" class="muted" style="font-size:12px;margin-top:4px;"></p></div></div>'

      resultArea.innerHTML = html
      syncState.data = data
      syncState.filter = 'all'
      syncState.page = 1
      renderSyncTable('all', 1, 20)

      document.getElementById('sync-filter').addEventListener('change', function() {
        syncState.filter = this.value; syncState.page = 1
        renderSyncTable(this.value, 1, parseInt(document.getElementById('sync-pagesize').value))
      })
      document.getElementById('sync-pagesize').addEventListener('change', function() {
        renderSyncTable(document.getElementById('sync-filter').value, 1, parseInt(this.value))
      })
      document.getElementById('sync-sel-all').addEventListener('click', function() {
        resultArea.querySelectorAll('input[type=checkbox]').forEach(function(c) { c.checked = true })
      })
      document.getElementById('sync-sel-rev').addEventListener('click', function() {
        resultArea.querySelectorAll('input[type=checkbox]').forEach(function(c) { c.checked = !c.checked })
      })

      // Sync handlers
      document.getElementById('sync-full-btn').addEventListener('click', function() {
        doSyncOp('full', [])
      })
      document.getElementById('sync-sel-btn').addEventListener('click', function() {
        var ids = Array.from(resultArea.querySelectorAll('input[type=checkbox]:checked')).map(function(c) { return Number(c.dataset.id) })
        if (!ids.length) return alert('请至少选中一个条目')
        doSyncOp('partial', ids)
      })
    }

    function renderSyncTable(filter, page, pageSize) {
      var data = syncState.data; if (!data) return
      var nameA = (data.userA && data.userA.name) || 'A'; var nameB = (data.userB && data.userB.name) || 'B'
      var rows = []

      function push(d, label, cb) {
        rows.push({ sid: d.externalId, name: d.title, a: label.a, b: label.b, cb: cb,
          color: d.typeA !== d.typeB ? '#e94560' : (d.epStatusA !== d.epStatusB ? '#ff9800' : '#a0a0b0') })
      }

      if (filter === 'all' || filter === 'diff') {
        ;(data.differences || []).forEach(function(d) {
          push(d, { a: typeLabel(d.typeA)+' | '+d.epStatusA+'话 | '+d.rateA+'分', b: typeLabel(d.typeB)+' | '+d.epStatusB+'话 | '+d.rateB+'分' }, true)
        })
      }
      if (filter === 'all' || filter === 'onlyA') {
        ;(data.onlyA || []).forEach(function(d) {
          push(d, { a: typeLabel(d.typeA)+' | '+d.epStatusA+'话 | '+d.rateA+'分', b: '—' }, true)
        })
      }
      if (filter === 'all' || filter === 'onlyB') {
        ;(data.onlyB || []).forEach(function(d) {
          push(d, { a: '—', b: typeLabel(d.typeB)+' | '+d.epStatusB+'话 | '+d.rateB+'分' }, true)
        })
      }
      if (filter === 'same') {
        ;(data.same || []).forEach(function(s) {
          rows.push({ sid: s.externalId, name: s.title, a: s.type+' | '+s.ep+'/'+(s.total||'??'), b: s.type+' | '+s.ep+'/'+(s.total||'??'), cb: false, color: '#4caf50' })
        })
      }

      var totalPages = Math.ceil(rows.length / pageSize) || 1
      var start = (page - 1) * pageSize
      var pageRows = rows.slice(start, start + pageSize)

      var h = '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
        '<thead><tr style="background:#0f3460;color:#a0a0b0;">' +
        '<th style="padding:6px;text-align:left;">条目 (' + rows.length + ')</th>' +
        '<th style="padding:6px;text-align:center;background:#1a2744;">' + nameA + '</th>' +
        '<th style="padding:6px;text-align:center;background:#1a2744;">' + nameB + '</th>' +
        '<th style="padding:6px;text-align:center;width:30px;">✓</th></tr></thead><tbody>'
      pageRows.forEach(function(r) {
        h += '<tr style="border-bottom:1px solid #2a2a4a;' + (r.color ? 'border-left:3px solid ' + r.color : '') + '">' +
          '<td style="padding:6px;">' + r.name + '</td>' +
          '<td style="padding:6px;text-align:center;background:#1a2744;">' + r.a + '</td>' +
          '<td style="padding:6px;text-align:center;">' + r.b + '</td>' +
          '<td style="padding:6px;text-align:center;">' + (r.cb ? '<input type="checkbox" checked data-id="' + r.sid + '">' : '') + '</td></tr>'
      })
      h += '</tbody></table>'

      if (totalPages > 1) {
        h += '<div style="display:flex;justify-content:center;gap:3px;margin-top:8px;">'
        var cp = page || 1; var pages = [1]
        var wStart = Math.max(2, cp - 4), wEnd = Math.min(totalPages - 1, cp + 4)
        if (wStart > 2) pages.push('...')
        for (var p = wStart; p <= wEnd; p++) pages.push(p)
        if (wEnd < totalPages - 1) pages.push('...')
        pages.push(totalPages)
        pages.forEach(function(p) {
          if (p === '...') {
            h += '<span style="padding:3px 4px;color:#a0a0b0;">...</span>'
          } else {
            h += '<button class="sync-pg-btn" data-pg="' + p + '" style="padding:3px 8px;font-size:11px;border:1px solid #2a2a4a;border-radius:3px;background:' + (p === cp ? '#e94560' : '#0f3460') + ';color:#fff;cursor:pointer;">' + p + '</button>'
          }
        })
        h += '</div>'
      }

      var tableEl = document.getElementById('sync-table')
      if (tableEl) {
        tableEl.innerHTML = h
        tableEl.querySelectorAll('.sync-pg-btn').forEach(function(b) {
          b.addEventListener('click', function() {
            syncState.page = parseInt(this.dataset.pg)
            renderSyncTable(document.getElementById('sync-filter').value, syncState.page, parseInt(document.getElementById('sync-pagesize').value))
          })
        })
      }
    }

    async function doSyncOp(mode, subjectIds) {
      var dir = document.getElementById('sync-direction').value
      var fromToken = dir === 'A->B' ? syncState.tokenA : syncState.tokenB
      var toToken = dir === 'A->B' ? syncState.tokenB : syncState.tokenA
      var fromUser = dir === 'A->B' ? 'A' : 'B'; var toUser = dir === 'A->B' ? 'B' : 'A'

      document.getElementById('sync-progress').style.display = ''
      document.getElementById('sync-progress-fill').style.width = '0%'
      document.getElementById('sync-progress-text').textContent = '正在同步...'

      try {
        var res = await fetch(API + '/api/manage/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tokenA: fromToken, platformA: "bgm", from: fromUser, tokenB: toToken, platformB: "bgm", to: toUser, mode: mode, subject_ids: subjectIds }),
        })
        var results = await res.json()
        var ok = results.filter(function(r) { return r.status === 'ok' }).length
        var err = results.filter(function(r) { return r.status === 'error' }).length
        document.getElementById('sync-progress-fill').style.width = '100%'
        document.getElementById('sync-progress-text').textContent = '同步完成：' + ok + ' 成功，' + err + ' 失败'
      } catch (e) {
        document.getElementById('sync-progress-text').textContent = '同步失败: ' + (e.message || '')
      }
    }

    return {
      el: view,
      activate: function() {
        if (loaded) return
        loaded = true
        document.getElementById('sync-compare-btn').addEventListener('click', async function() {
          var ta = document.getElementById('sync-tokenA').value.trim()
          var tb = document.getElementById('sync-tokenB').value.trim()
          if (!ta || !tb) return alert('请填写两个账号的 Access Token')
          syncState.tokenA = ta; syncState.tokenB = tb

          resultArea.innerHTML = '<p class="bgm-status">正在加载双方收藏数据...</p>'
          try {
            var res = await fetch(API + '/api/manage/compare', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tokenA: ta, platformA: document.getElementById('sync-platformA').value, tokenB: tb, platformB: document.getElementById('sync-platformB').value }),
            })
            var data = await res.json()
            if (!res.ok) throw new Error(data.error || '请求失败')
            renderCompareResult(data)
          } catch (e) {
            resultArea.innerHTML = '<p class="bgm-error">对比失败: ' + (e.message || '未知错误') + '</p>'
          }
        })
      },
    }
  }

  function statusLabel(t) { return ({1:'想看',2:'看过',3:'在看',4:'搁置',5:'抛弃',0:'—'})[t] || t }

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
