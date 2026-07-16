import { createApp } from 'vue';
import { gsap } from 'gsap';
import IslandShell from './IslandShell.vue';
import './island-shell.css';

const mount = document.getElementById('island-shell');
if (mount) createApp(IslandShell).mount(mount);

const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const compactScreen = window.matchMedia?.('(max-width: 840px)').matches;

function revealElements(root = document) {
  if (reduceMotion || !root?.querySelectorAll) return;
  const targets = root.querySelectorAll('.group:not([data-motion-ready]), .renew-card:not([data-motion-ready]), .manage-item:not([data-motion-ready]), .settings-section:not([data-motion-ready]), .cal-grid .cell:not(.empty):not([data-motion-ready])');
  if (!targets.length) return;
  targets.forEach((target) => { target.dataset.motionReady = 'true'; });
  gsap.fromTo(targets,
    { autoAlpha: 0, y: 20, rotate: (index) => (index % 2 ? 0.45 : -0.45), scale: 0.975 },
    { autoAlpha: 1, y: 0, rotate: 0, scale: 1, duration: 0.52, stagger: 0.045, ease: 'back.out(1.18)', clearProps: 'transform,opacity,visibility' });

  root.querySelectorAll('.check-animating:not([data-celebrated])').forEach(celebrateCheck);
}

function celebrateCheck(item) {
  item.dataset.celebrated = 'true';
  const burst = document.createElement('span');
  burst.className = 'leaf-burst';
  for (let index = 0; index < 10; index += 1) {
    const leaf = document.createElement('i');
    leaf.style.setProperty('--leaf-color', ['#f3ca5e', '#64b985', '#7fd0c5', '#ee9b88'][index % 4]);
    burst.appendChild(leaf);
  }
  item.appendChild(burst);
  const leaves = burst.querySelectorAll('i');
  gsap.set(leaves, { x: 0, y: 0, scale: 0, rotate: 0 });
  gsap.to(leaves, {
    x: (index) => Math.cos((Math.PI * 2 * index) / leaves.length) * (44 + (index % 3) * 12),
    y: (index) => Math.sin((Math.PI * 2 * index) / leaves.length) * (34 + (index % 2) * 14) - 12,
    rotate: (index) => 120 + index * 47,
    scale: (index) => 0.8 + (index % 3) * 0.15,
    autoAlpha: 0,
    duration: 0.82,
    stagger: 0.018,
    ease: 'power2.out',
    onComplete: () => burst.remove(),
  });
}

function animateView(tab) {
  if (reduceMotion) return;
  window.setTimeout(() => {
    const view = document.getElementById(`view-${tab}`);
    if (!view || view.classList.contains('hidden')) return;
    const heading = view.querySelector('.section-head, .today-head');
    if (heading) gsap.fromTo(heading, { autoAlpha: 0, y: -10, scale: 0.985 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.4, ease: 'power2.out', clearProps: 'all' });
    revealElements(view);
  }, 170);
}

function startAmbientMotion() {
  if (reduceMotion) return;
  if (!compactScreen) {
    const timeline = gsap.timeline();
    timeline.from('.hero-copy', { autoAlpha: 0, x: -26, duration: 0.7, ease: 'power3.out' })
      .from('.hero-world', { autoAlpha: 0, y: 24, rotate: 1.2, scale: 0.96, duration: 0.8, ease: 'back.out(1.25)' }, '-=.5')
      .from('.hero-progress-card', { autoAlpha: 0, x: 24, scale: 0.86, duration: 0.62, ease: 'back.out(1.6)' }, '-=.5')
      .from('.hero-action', { autoAlpha: 0, y: 10, stagger: 0.07, duration: 0.36, ease: 'back.out(1.7)' }, '-=.35');
  }

  gsap.to('.scene-cloud-a', { x: 34, duration: 13, repeat: -1, yoyo: true, ease: 'sine.inOut' });
  gsap.to('.scene-cloud-b', { x: -26, duration: 16, repeat: -1, yoyo: true, ease: 'sine.inOut' });
  gsap.to('.scene-butterfly', { x: 28, y: -16, rotate: 8, transformOrigin: 'center', duration: 3.1, repeat: -1, yoyo: true, ease: 'sine.inOut' });
  gsap.to('.scene-tree-a', { rotate: 1.5, transformOrigin: '50% 100%', duration: 2.8, repeat: -1, yoyo: true, ease: 'sine.inOut' });
  gsap.to('.scene-tree-b', { rotate: -1.2, transformOrigin: '50% 100%', duration: 3.4, repeat: -1, yoyo: true, ease: 'sine.inOut' });
  gsap.to('.scene-water-line', { x: 10, autoAlpha: 0.32, duration: 2.2, repeat: -1, yoyo: true, ease: 'sine.inOut' });
}

window.addEventListener('island:tab', (event) => animateView(event.detail?.tab || 'today'));
window.addEventListener('island:sparkle', () => {
  if (reduceMotion) return;
  const leaves = document.querySelectorAll('.ambient-leaf');
  gsap.fromTo(leaves, { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 0.82, rotate: '+=220', x: '+=28', y: '+=38', duration: 1.2, stagger: 0.07, ease: 'power2.out', clearProps: 'all' });
});

const observer = new MutationObserver((entries) => {
  for (const entry of entries) {
    if (entry.type === 'childList' && entry.addedNodes.length) revealElements(entry.target.closest?.('.view') || entry.target);
  }
});
document.querySelectorAll('.view').forEach((view) => observer.observe(view, { childList: true, subtree: true }));

const hero = document.querySelector('.hero-world');
if (hero && !reduceMotion && !compactScreen) {
  const moveX = gsap.quickTo(hero, 'x', { duration: 0.6, ease: 'power3.out' });
  const moveY = gsap.quickTo(hero, 'y', { duration: 0.6, ease: 'power3.out' });
  hero.addEventListener('pointermove', (event) => {
    const rect = hero.getBoundingClientRect();
    moveX(((event.clientX - rect.left) / rect.width - 0.5) * 8);
    moveY(((event.clientY - rect.top) / rect.height - 0.5) * 6);
  });
  hero.addEventListener('pointerleave', () => { moveX(0); moveY(0); });
}

startAmbientMotion();
revealElements(document.querySelector('.view:not(.hidden)'));
