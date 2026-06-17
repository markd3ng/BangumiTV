(function () {
  const config = window.bgmConfig || { apiUrl: '', quote: '' }
  const API = (config.apiUrl || '').replace(/\/$/, '')
  const container = document.querySelector('.bgm-container')
  if (!container || !API) return

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

  function renderCard(entry) {
    const imgUrl = entry.images?.hash
      ? `${API}/image/${entry.images.hash}?w=300&fmt=webp`
      : 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" fill="#333"><rect width="300" height="400"/></svg>')

    const progress = entry.total_episodes > 0
      ? Math.round((entry.ep_status / entry.total_episodes) * 100)
      : 0

    return '<a href="https://bgm.tv/subject/' + entry.subject_id + '" target="_blank" class="bgm-card' + (entry.nsfw ? ' bgm-nsfw' : '') + '">' +
      '<div class="bgm-card-cover">' +
        '<img src="' + imgUrl + '" alt="' + (entry.name_cn || entry.name) + '" loading="lazy">' +
        (entry.nsfw ? '<div class="bgm-nsfw-overlay" onclick="event.preventDefault();this.parentElement.parentElement.classList.toggle(\'bgm-nsfw-reveal\')">R18</div>' : '') +
      '</div>' +
      '<div class="bgm-card-info">' +
        '<h3>' + (entry.name_cn || entry.name) + '</h3>' +
        (progress > 0 ? '<div class="bgm-progress"><span style="width:' + progress + '%"></span></div>' : '') +
        '<span class="bgm-ep">' + entry.ep_status + '/' + (entry.total_episodes || '??') + '</span>' +
      '</div>' +
    '</a>'
  }

  async function render() {
    const nav = document.createElement('div')
    nav.className = 'bgm-nav'
    const keys = Object.keys(TYPE_NAMES)
    let navHtml = ''
    for (let i = 0; i < keys.length; i++) {
      navHtml += '<button data-type="' + keys[i] + '">' + TYPE_NAMES[keys[i]] + '</button>'
    }
    nav.innerHTML = navHtml
    container.appendChild(nav)

    const grid = document.createElement('div')
    grid.className = 'bgm-grid'
    container.appendChild(grid)

    const pagination = document.createElement('div')
    pagination.className = 'bgm-pagination'
    container.appendChild(pagination)

    let currentType = 'watching'
    let currentPage = 1

    async function load(type, page) {
      try {
        const res = await fetch(API + '/api/collections?type=' + type + '&page=' + page + '&limit=24')
        const data = await res.json()
        let cardsHtml = ''
        for (let i = 0; i < data.data.length; i++) {
          cardsHtml += renderCard(data.data[i])
        }
        grid.innerHTML = cardsHtml

        const totalPages = Math.ceil(data.total / 24)
        pagination.innerHTML = ''
        for (let i = 1; i <= totalPages; i++) {
          const btn = document.createElement('button')
          btn.textContent = i
          if (i === page) btn.classList.add('active')
          ;(function(p) { btn.onclick = function() { currentPage = p; load(currentType, p) } })(i)
          pagination.appendChild(btn)
        }
      } catch (e) {
        grid.innerHTML = '<p style="color:#a0a0b0;">加载失败</p>'
      }
    }

    nav.addEventListener('click', function(e) {
      if (e.target.tagName === 'BUTTON') {
        currentType = e.target.dataset.type
        currentPage = 1
        load(currentType, 1)
      }
    })

    await checkNSFW()
    load(currentType, 1)
  }

  render()
})()
