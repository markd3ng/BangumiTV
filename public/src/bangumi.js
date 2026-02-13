document.addEventListener('DOMContentLoaded', () => {
  const apiBase = '/api';
  const container = document.querySelector('.bgm-container');
  const categories = ['watching', 'watched', 'want'];
  let currentType = 'watching';
  let currentOffset = 0;
  const limit = 12;

  // --- State & UI Helpers ---

  const showLoading = (isDaily = false) => {
    const targetId = isDaily ? 'day-content' : 'collection-section';
    const target = document.getElementById(targetId);
    if (!target) return;

    target.innerHTML = '';
    const count = isDaily ? 6 : 4;
    for (let i = 0; i < count; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = isDaily ? 'bgm-matrix-item bgm-skeleton' : 'bgm-item bgm-skeleton';
      skeleton.style.minHeight = isDaily ? '350px' : '180px';
      target.appendChild(skeleton);
    }
  };

  const clearActiveTabs = (selector) => {
    document.querySelectorAll(selector).forEach(t => t.classList.remove('bgm-active'));
  };

  // --- Data Fetching ---

  const fetchCollection = async (type, offset = 0, append = false) => {
    if (!append) showLoading();
    try {
      const response = await fetch(`${apiBase}/bangumi?type=${type}&offset=${offset}&limit=${limit}`);
      const result = await response.json();
      renderCollection(result.data, append);

      // Show/Hide Load More
      const total = result.total || 0;
      const nav = document.querySelector('.bgm-navigator');
      if (offset + limit < total) {
        nav.style.display = 'block';
      } else {
        nav.style.display = 'none';
      }
    } catch (error) {
      console.error('Failed to fetch collection:', error);
    }
  };

  const fetchCalendar = async () => {
    showLoading(true);
    try {
      const response = await fetch(`${apiBase}/calendar`);
      const calendarData = await response.json();
      window.calendarData = calendarData; // Cache in window for day switching

      // Default to today
      const today = new Date().getDay(); // 0 is Sunday
      const dayTab = document.querySelector(`.day-tab[data-day="${today}"]`);
      if (dayTab) dayTab.click();
    } catch (error) {
      console.error('Failed to fetch calendar:', error);
    }
  };

  // --- Rendering ---

  const renderCollection = (items, append) => {
    const target = document.getElementById('collection-section');
    if (!append) target.innerHTML = '';

    items.forEach(item => {
      const percentage = item.eps > 0 ? Math.round((item.ep_status / item.eps) * 100) : 0;
      const cover = (item.images && item.images.large) ? item.images.large : 'https://placehold.co/150x200?text=No+Image';

      const card = `
                <div class="bgm-item">
                    <div class="bgm-item-thumb" 
                         style="background-image:url('${cover}')" 
                         onclick="window.showLightbox('${cover}')"
                         title="点击查看大图"></div>
                    <div class="bgm-item-info">
                        <a class="bgm-item-title-link" href="https://bgm.tv/subject/${item.id}" target="_blank">
                            <span class="bgm-item-title main">${item.name_cn || item.name}</span>
                        </a>
                        <span class="bgm-item-title">${item.name}</span>
                        <div class="bgm-item-statusBar-container">
                            <div class="bgm-item-statusBar" style="width:${percentage}%"></div>
                            <span class="bgm-item-progress-text">${item.ep_status} / ${item.eps || '??'}</span>
                        </div>
                    </div>
                </div>
            `;
      target.insertAdjacentHTML('beforeend', card);
    });
  };

  // --- Lightbox Implementation ---
  const lightbox = document.createElement('div');
  lightbox.className = 'bgm-lightbox';
  lightbox.innerHTML = '<img src="" alt="Zoomed Cover">';
  document.body.appendChild(lightbox);

  window.showLightbox = (url) => {
    const img = lightbox.querySelector('img');
    img.src = url;
    lightbox.classList.add('active');
  };

  lightbox.addEventListener('click', () => {
    lightbox.classList.remove('active');
  });

  const renderDay = (dayIndex) => {
    const target = document.getElementById('day-content');
    target.innerHTML = '';

    // Find day data (bgm.tv calendar uses 1=Mon...7=Sun)
    const dayData = window.calendarData.find(d => d.weekday.id === (dayIndex === 0 ? 7 : dayIndex));
    if (!dayData || !dayData.items) return;

    const weekdayLabel = dayData.weekday.cn.replace('星期', '周');

    dayData.items.forEach(item => {
      const cover = (item.images && item.images.large) ? item.images.large : 'https://placehold.co/150x200?text=No+Image';
      const card = `
                <div class="bgm-matrix-item">
                    <div class="bgm-matrix-thumb" 
                         style="background-image:url('${cover}')" 
                         onclick="window.showLightbox('${cover}')"
                         title="点击查看大图"></div>
                    <a class="bgm-item-title-link" href="https://bgm.tv/subject/${item.id}" target="_blank">
                        <span class="bgm-matrix-title">${item.name_cn || item.name}</span>
                    </a>
                </div>
            `;
      target.insertAdjacentHTML('beforeend', card);
    });
  };

  // --- Event Listeners ---

  // Collection Category Switching
  document.querySelectorAll('.cat-tab').forEach((tab, index) => {
    tab.addEventListener('click', () => {
      clearActiveTabs('.cat-tab');
      tab.classList.add('bgm-active');
      currentType = categories[index];
      currentOffset = 0;
      fetchCollection(currentType);

      // Switch view
      document.getElementById('collection-section').style.display = 'grid';
      document.getElementById('daily-section').style.display = 'none';
    });
  });

  // Daily Bangumi Toggle
  document.getElementById('btn-daily').addEventListener('click', () => {
    clearActiveTabs('.bgm-tab');
    document.getElementById('btn-daily').classList.add('bgm-active');
    document.getElementById('collection-section').style.display = 'none';
    document.getElementById('daily-section').style.display = 'block';
    if (!window.calendarData) {
      fetchCalendar();
    }
  });

  // Day Switching
  document.querySelectorAll('.day-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      clearActiveTabs('.day-tab');
      tab.classList.add('bgm-active');
      const day = parseInt(tab.dataset.day);
      renderDay(day);
    });
  });

  // Load More
  document.querySelector('.bgm-btn').addEventListener('click', () => {
    currentOffset += limit;
    fetchCollection(currentType, currentOffset, true);
  });

  // Initial Load
  fetchCollection(currentType);
});
