// 内联的静态资源——Worker 提供主页和 JS/CSS，避免跨域依赖 Pages。
// 源文件位于 public/，修改时需同步更新此处。

export const INDEX_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="src/bangumi.css">
  <style>
    blockquote { border-left: .25em solid #dfe2e5; color: #6a737d; padding: 0 1em; margin-left: 0; }
  </style>
  <script>
    const bgmConfig = {
      apiUrl: "https://<WORKER_DOMAIN>",
      quote: "生命不止，追番不息！"
    }
  </script>
  <title>BangumiTV</title>
</head>
<body>
  <div id="bgm-age-modal" style="display:none;">
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;">
      <div style="background:#16213e;padding:40px;border-radius:12px;text-align:center;max-width:400px;">
        <h2 style="color:#fff;">⚠️ 内容警告</h2>
        <p style="color:#a0a0b0;margin:20px 0;">本页面包含成人内容（R18），您是否已满18岁？</p>
        <button onclick="bgmConfirmAge()" style="padding:12px 32px;background:#e94560;border:none;border-radius:8px;color:#fff;cursor:pointer;margin:4px;">我已满18岁，进入</button>
        <button onclick="bgmLeaveAge()" style="padding:12px 32px;background:#0f3460;border:none;border-radius:8px;color:#fff;cursor:pointer;margin:4px;">离开</button>
      </div>
    </div>
  </div>
  <div class="bgm-container"></div>
  <script src="src/bangumi.js"></script>
</body>
</html>
`

export const BANGUMI_JS = `(function () {
  const config = window.bgmConfig || { apiUrl: '', quote: '' }
  const API = (config.apiUrl || window.location.origin).replace(/\\/\$/, '')
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
    if (entry.nsfw) html += '<div class="bgm-nsfw-overlay" onclick="event.preventDefault();this.parentElement.parentElement.classList.toggle(\\'bgm-nsfw-reveal\\')">R18</div>';
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
        var c = health.data.collections
        statusHtml = '<p style="color:#00a1d6;text-align:center;font-size:12px;">已连接 | 条目 ' + (c.types && c.types._total) + ' | 更新于 ' + (c.updated_at || '?').slice(0, 10) + '</p>'
      } else if (health.ok) {
        var hint = '请在 /manage 授权并触发同步'
        if (health.data && health.data.last_error) hint += '<br>上次同步错误: ' + health.data.last_error
        statusHtml = '<p style="color:#e94560;text-align:center;font-size:12px;">已连接，但 KV 无数据。' + hint + '</p>'
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
`

export const BANGUMI_CSS = `  width: 100%;
  padding: 20px 0;
}

.bgm-nav {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.bgm-nav button {
  padding: 6px 16px;
  border: 1px solid #ddd;
  border-radius: 16px;
  background: #fff;
  color: #555;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}
.bgm-nav button:hover,
.bgm-nav button.active {
  background: #00a1d6;
  color: #fff;
  border-color: #00a1d6;
}

.bgm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}

.bgm-card {
  display: block;
  text-decoration: none;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  transition: box-shadow 0.2s;
}
.bgm-card:hover {
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
}

.bgm-card-cover {
  position: relative;
  overflow: hidden;
  aspect-ratio: 3/4;
  background: #f0f0f0;
}
.bgm-card-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.bgm-card-info {
  padding: 8px 10px;
}
.bgm-card-info h3 {
  font-size: 13px;
  margin: 0 0 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #333;
}

.bgm-progress {
  height: 4px;
  background: #e0e0e0;
  border-radius: 2px;
  margin: 4px 0;
}
.bgm-progress span {
  display: block;
  height: 100%;
  background: #00a1d6;
  border-radius: 2px;
}

.bgm-ep {
  font-size: 12px;
  color: #999;
}

.bgm-pagination {
  text-align: center;
  margin-top: 20px;
  display: flex;
  justify-content: center;
  gap: 6px;
  flex-wrap: wrap;
}
.bgm-pagination button {
  width: 36px;
  height: 36px;
  border: 1px solid #ddd;
  border-radius: 18px;
  background: #fff;
  color: #555;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}
.bgm-pagination button:hover,
.bgm-pagination button.active {
  background: #00a1d6;
  color: #fff;
  border-color: #00a1d6;
}

/* NSFW 模糊遮罩 */
.bgm-card.bgm-nsfw .bgm-card-cover img {
  filter: blur(20px);
  transition: filter 0.3s;
}
.bgm-card.bgm-nsfw.bgm-nsfw-reveal .bgm-card-cover img {
  filter: blur(0);
}
.bgm-nsfw-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.5);
  color: #e94560;
  font-size: 18px;
  font-weight: bold;
  cursor: pointer;
  z-index: 2;
}
.bgm-nsfw-reveal .bgm-nsfw-overlay {
  display: none;
`
