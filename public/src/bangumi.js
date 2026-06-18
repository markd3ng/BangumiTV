(function () {
  const config = window.bgmConfig || { apiUrl: '', quote: '' }
  const API = (config.apiUrl || window.location.origin).replace(/\/$/, '')
  const container = document.querySelector('.bgm-container')
  if (!container) return

  const TYPE_NAMES = { want: '想看', watched: '看过', watching: '在看', on_hold: '搁置', dropped: '抛弃' }

  async function checkNSFW() {
    try {
      const res = await fetch(API + '/api/config?key=nsfw')
      const data = await res.json()
      if (data.nsfw && !localStorage.getItem('bgm-age-confirmed')) {
        document.getElementById('bgm-age-modal').style.display = 'block'
      } else if (!data.nsfw) {
        localStorage.removeItem('bgm-age-confirmed')
      }
    } catch (e) {}
  }

  window.bgmConfirmAge = function () {
    localStorage.setItem('bgm-age-confirmed', '1')
    document.getElementById('bgm-age-modal').style.display = 'none'
  }

  window.bgmLeaveAge = function () {
    window.location.href = 'https://www.google.com'
  }

  function renderCard(entry) {
    const imgUrl = entry.images && entry.images.hash
      ? API + '/image/' + entry.images.hash + '?w=300&fmt=webp'
      : 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" fill="#333"><rect width="300" height="400"/></svg>')

    const progress = entry.total_episodes > 0
      ? Math.round((entry.ep_status / entry.total_episodes) * 100)
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
    html += '<span class="bgm-ep">' + entry.ep_status + '/' + (entry.total_episodes || '??') + '</span>' +
      '</div>' +
    '</a>';
    return html;
  }

  async function render() {
    var nav = document.createElement('div')
    nav.className = 'bgm-nav'
    var keys = Object.keys(TYPE_NAMES)
    var navHtml = ''
    for (var i = 0; i < keys.length; i++) {
      navHtml += '<button data-type="' + keys[i] + '">' + TYPE_NAMES[keys[i]] + '</button>'
    }
    nav.innerHTML = navHtml
    container.appendChild(nav)

    var grid = document.createElement('div')
    grid.className = 'bgm-grid'
    container.appendChild(grid)

    var pagination = document.createElement('div')
    pagination.className = 'bgm-pagination'
    container.appendChild(pagination)

    var currentType = 'watching'
    var currentPage = 1

    async function load(type, page) {
      try {
        var res = await fetch(API + '/api/collections?type=' + type + '&page=' + page + '&limit=24')
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText)
        var data = await res.json()
        if (data.total === 0) {
          grid.innerHTML = '<p style="color:#a0a0b0;padding:40px;text-align:center;">暂无数据 — 同步可能尚未执行，请在 /manage 授权并触发同步</p>'
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
        grid.innerHTML = '<p style="color:#e94560;padding:40px;text-align:center;">加载失败: ' + (e.message || '未知错误') + '<br><small style="color:#a0a0b0;">API: ' + API + '</small></p>'
      }
    }

    nav.addEventListener('click', function(e) {
      if (e.target.tagName === 'BUTTON') {
        currentType = e.target.dataset.type
        currentPage = 1
        load(currentType, 1)
      }
    })

    // 健康检查：启动时显示连接和同步状态。
    var statusHtml = '<p style="color:#a0a0b0;text-align:center;">正在连接...</p>'
    grid.innerHTML = statusHtml
    try {
      var healthRes = await fetch(API + '/api/health')
      var health = await healthRes.json()
      if (health.ok && health.data && health.data.collections) {
        statusHtml = '<p style="color:#00a1d6;text-align:center;font-size:12px;">已连接 | 条目 ' + health.data.collections._total + ' | 更新于 ' + (health.data.collections.updated_at || '?').slice(0, 10) + '</p>'
      } else if (health.ok) {
        statusHtml = '<p style="color:#e94560;text-align:center;font-size:12px;">已连接，但 KV 无数据。请在 /manage 授权并触发同步</p>'
      } else {
        statusHtml = '<p style="color:#e94560;text-align:center;font-size:12px;">健康检查失败: ' + (health.error || '') + '</p>'
      }
    } catch(e) {
      statusHtml = '<p style="color:#e94560;text-align:center;font-size:12px;">无法连接 Worker: ' + (e.message||'') + '</p>'
    }
    var statusBar = document.createElement('div')
    statusBar.innerHTML = statusHtml
    statusBar.style.cssText = 'margin-bottom:12px;padding:8px;background:#16213e;border-radius:8px;'
    container.insertBefore(statusBar, nav)
    setTimeout(function(){ statusBar.style.opacity = '0.4' }, 3000)

    await checkNSFW()
    load(currentType, 1)
  }

  render()
})()
