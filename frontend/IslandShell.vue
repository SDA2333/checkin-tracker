<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const now = ref(new Date());
const progress = ref({ done: 0, total: 0, date: '' });
const activeTab = ref('today');
const renewals = ref(0);
let clockTimer;

const progressPct = computed(() => progress.value.total
  ? Math.round((progress.value.done / progress.value.total) * 100)
  : 0);
const ringOffset = computed(() => 276.46 * (1 - progressPct.value / 100));
const greeting = computed(() => {
  const hour = now.value.getHours();
  if (hour < 6) return '夜深了，小岛还亮着灯';
  if (hour < 11) return '早上好，海风刚刚醒来';
  if (hour < 14) return '中午好，树荫正舒服';
  if (hour < 18) return '下午好，云朵慢慢散步';
  return '晚上好，萤火虫来值班了';
});
const dateLabel = computed(() => new Intl.DateTimeFormat('zh-CN', {
  month: 'long', day: 'numeric', weekday: 'long',
}).format(now.value));
const timeLabel = computed(() => new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(now.value));
const progressCopy = computed(() => {
  if (!progress.value.total) return '先种下第一件今日小事';
  if (progressPct.value === 100) return '今日岛务全部完成，去吹吹海风吧';
  if (progressPct.value >= 60) return '已经走过大半，终点就在前面';
  return `再完成 ${progress.value.total - progress.value.done} 项，岛屿会更有生气`;
});

const leaves = [
  { x: '8%', y: '18%', delay: '0s', size: 13 },
  { x: '20%', y: '72%', delay: '-4s', size: 10 },
  { x: '78%', y: '12%', delay: '-8s', size: 12 },
  { x: '92%', y: '52%', delay: '-2s', size: 9 },
  { x: '60%', y: '82%', delay: '-6s', size: 11 },
  { x: '36%', y: '8%', delay: '-10s', size: 8 },
];

function onProgress(event) { progress.value = { ...progress.value, ...event.detail }; }
function onTab(event) { activeTab.value = event.detail?.tab || 'today'; }
function onRenewals(event) { renewals.value = Number(event.detail?.urgent || 0); }
function navigate(tab) { window.dispatchEvent(new CustomEvent('island:navigate', { detail: { tab } })); }
function sparkle() { window.dispatchEvent(new CustomEvent('island:sparkle')); }

onMounted(() => {
  window.addEventListener('island:progress', onProgress);
  window.addEventListener('island:tab', onTab);
  window.addEventListener('island:renewals', onRenewals);
  clockTimer = window.setInterval(() => { now.value = new Date(); }, 30000);
});

onBeforeUnmount(() => {
  window.removeEventListener('island:progress', onProgress);
  window.removeEventListener('island:tab', onTab);
  window.removeEventListener('island:renewals', onRenewals);
  window.clearInterval(clockTimer);
});
</script>

<template>
  <div class="island-ambient" aria-hidden="true">
    <div class="ambient-orb ambient-orb-one"></div>
    <div class="ambient-orb ambient-orb-two"></div>
    <span
      v-for="(leaf, index) in leaves"
      :key="index"
      class="ambient-leaf"
      :style="{ left: leaf.x, top: leaf.y, animationDelay: leaf.delay, width: `${leaf.size}px`, height: `${leaf.size * 0.72}px` }"
    ></span>
    <div class="ambient-side ambient-side-left">
      <span class="ambient-sign-post"></span>
      <div class="ambient-sign-board">
        <small>DAILY</small>
        <strong>ISLAND</strong>
        <span>→</span>
      </div>
      <span class="ambient-side-leaf leaf-one"></span>
      <span class="ambient-side-leaf leaf-two"></span>
      <span class="ambient-side-flower">✿</span>
    </div>
    <div class="ambient-side ambient-side-right">
      <div class="ambient-balloon"><span>✦</span></div>
      <span class="ambient-balloon-tail"></span>
      <span class="ambient-balloon-string"></span>
      <div class="ambient-shrub">
        <span></span><span></span><span></span>
      </div>
      <span class="ambient-side-flower">✿</span>
    </div>
  </div>

  <section class="island-hero" aria-labelledby="island-greeting">
    <div class="hero-paper hero-copy">
      <div class="hero-kicker"><span class="hero-kicker-dot"></span> ISLAND DAILY BOARD</div>
      <h1 id="island-greeting">{{ greeting }}</h1>
      <p>{{ progressCopy }}</p>
      <div class="hero-meta" aria-label="小岛信息">
        <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3m10-3v3M4.5 9h15M6 5h12a2 2 0 0 1 2 2v12H4V7a2 2 0 0 1 2-2Z"/></svg>{{ dateLabel }}</span>
        <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h10a3 3 0 1 0-3-3M4 16h14a2 2 0 1 1-2 2"/></svg>薄荷海风</span>
        <span class="hero-clock">{{ timeLabel }}</span>
      </div>
      <div class="hero-actions">
        <button type="button" class="hero-action primary" @click="navigate('today')">
          <span aria-hidden="true">✓</span> 今日岛务
        </button>
        <button type="button" class="hero-action" @click="navigate('calendar')">
          <span aria-hidden="true">✿</span> 看看足迹
        </button>
        <button type="button" class="hero-action icon-only" aria-label="撒一把叶片" title="撒一把叶片" @click="sparkle">🍃</button>
      </div>
    </div>

    <div class="hero-world" aria-hidden="true">
      <svg class="hero-world-svg" viewBox="0 0 620 320" role="presentation">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#bfe9e0"/><stop offset="1" stop-color="#f7edbd"/></linearGradient>
          <linearGradient id="water" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#71d4d0"/><stop offset="1" stop-color="#42aeb9"/></linearGradient>
          <filter id="softShadow"><feDropShadow dx="0" dy="7" stdDeviation="5" flood-color="#496d62" flood-opacity=".2"/></filter>
        </defs>
        <rect width="620" height="320" rx="44" fill="url(#sky)"/>
        <g class="scene-cloud scene-cloud-a"><path d="M58 74c2-17 16-28 32-25 6-16 29-20 41-7 20-2 34 10 36 28H58Z" fill="#fffbe7" opacity=".9"/></g>
        <g class="scene-cloud scene-cloud-b"><path d="M428 50c3-14 15-23 29-20 8-15 29-15 37 0 17-2 29 8 31 23h-97Z" fill="#fffbe7" opacity=".76"/></g>
        <circle class="scene-sun" cx="522" cy="78" r="31" fill="#f8cf62" opacity=".92"/>
        <path d="M0 192c74-39 132-32 196 1 58-46 145-54 223-3 67-36 133-29 201 11v119H0Z" fill="#8fce8e"/>
        <path d="M0 237c111-42 205-29 280 14 87-44 205-49 340 6v63H0Z" fill="#69b978"/>
        <path d="M188 320c28-64 51-82 91-95 39-12 58-45 63-81 37 54 52 93 41 176Z" fill="url(#water)"/>
        <path class="scene-water-line" d="M245 265c40-10 76-8 111 2M229 288c43-9 88-7 132 4M304 218c18-5 35-4 52 1" fill="none" stroke="#d6fff2" stroke-width="4" stroke-linecap="round" opacity=".65"/>
        <g class="scene-house" filter="url(#softShadow)">
          <path d="M85 204h104v74H85Z" fill="#fff2c9" stroke="#755f45" stroke-width="4"/>
          <path d="m73 207 64-55 66 55Z" fill="#ef9a73" stroke="#755f45" stroke-width="5" stroke-linejoin="round"/>
          <path d="M126 230h27v48h-27Z" fill="#7dc3b4" stroke="#755f45" stroke-width="4"/>
          <path d="M93 224h22v22H93Zm68 0h21v22h-21Z" fill="#aee0da" stroke="#755f45" stroke-width="3"/>
          <circle cx="147" cy="254" r="2.7" fill="#f8d05f"/>
        </g>
        <g class="scene-tree scene-tree-a" filter="url(#softShadow)">
          <path d="M477 261v-69" stroke="#8e6747" stroke-width="14" stroke-linecap="round"/>
          <circle cx="477" cy="170" r="43" fill="#56aa72"/><circle cx="447" cy="184" r="29" fill="#6fc285"/><circle cx="508" cy="184" r="30" fill="#6fc285"/>
          <circle cx="459" cy="159" r="5" fill="#f7ca5d"/><circle cx="496" cy="175" r="5" fill="#f7ca5d"/>
        </g>
        <g class="scene-tree scene-tree-b" filter="url(#softShadow)">
          <path d="M555 280v-48" stroke="#8e6747" stroke-width="11" stroke-linecap="round"/>
          <circle cx="555" cy="215" r="31" fill="#479b68"/><circle cx="535" cy="225" r="21" fill="#67b87c"/><circle cx="577" cy="226" r="22" fill="#67b87c"/>
        </g>
        <g class="scene-bridge" filter="url(#softShadow)">
          <path d="M271 236c26-18 51-17 76 1l-5 23c-22-12-45-12-66 0Z" fill="#c98a55" stroke="#765c40" stroke-width="4"/>
          <path d="M282 239v17m18-24v18m20-16v17m17-12v17" stroke="#f1bd76" stroke-width="4"/>
        </g>
        <g class="scene-flowers">
          <g transform="translate(44 267)"><circle r="5" fill="#fff6dd"/><circle cx="-4" cy="-3" r="3" fill="#f49d9d"/><circle cx="4" cy="-3" r="3" fill="#f49d9d"/><path d="M0 5v16" stroke="#3f8e5e" stroke-width="3"/></g>
          <g transform="translate(214 282)"><circle r="5" fill="#fff6dd"/><circle cx="-4" cy="-3" r="3" fill="#8ccad4"/><circle cx="4" cy="-3" r="3" fill="#8ccad4"/><path d="M0 5v14" stroke="#3f8e5e" stroke-width="3"/></g>
          <g transform="translate(424 278)"><circle r="5" fill="#fff6dd"/><circle cx="-4" cy="-3" r="3" fill="#f1c55b"/><circle cx="4" cy="-3" r="3" fill="#f1c55b"/><path d="M0 5v14" stroke="#3f8e5e" stroke-width="3"/></g>
        </g>
        <g class="scene-butterfly"><path d="M390 119c-15-12-25 3-11 13-12 13 5 23 14 8 9 15 26 5 14-8 14-10 4-25-11-13Z" fill="#f3c95f"/><path d="M393 119v22" stroke="#775e44" stroke-width="3"/></g>
        <path class="scene-bird scene-bird-a" d="M239 76q10-10 20 0 10-10 20 0" fill="none" stroke="#6f806f" stroke-width="3" stroke-linecap="round"/>
        <path class="scene-bird scene-bird-b" d="M311 56q8-8 16 0 8-8 16 0" fill="none" stroke="#6f806f" stroke-width="3" stroke-linecap="round"/>
      </svg>
      <span class="world-label">TODAY'S ISLAND</span>
    </div>

    <div class="hero-progress-card" role="status" aria-live="polite">
      <svg viewBox="0 0 108 108" aria-hidden="true">
        <circle class="progress-track" cx="54" cy="54" r="44"/>
        <circle class="progress-value" cx="54" cy="54" r="44" :style="{ strokeDashoffset: ringOffset }"/>
      </svg>
      <div class="progress-center"><strong>{{ progressPct }}<small>%</small></strong><span>今日进度</span></div>
      <div class="progress-numbers"><b>{{ progress.done }}</b><span>/ {{ progress.total || '—' }}</span></div>
    </div>
  </section>

  <div class="island-guide" :class="{ visible: activeTab !== 'today' || renewals > 0 }">
    <button v-if="renewals > 0" type="button" @click="navigate('renew')">
      <span class="guide-sprout">♧</span><b>{{ renewals }}</b><em>项续期要留意</em>
    </button>
    <button v-else-if="activeTab !== 'today'" type="button" @click="navigate('today')">
      <span>🏡</span><em>回今日岛务</em>
    </button>
  </div>
</template>
