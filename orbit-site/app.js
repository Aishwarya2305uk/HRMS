/* Orbit product site — all interactivity, no dependencies. */
(function () {
  'use strict'

  /* Where the actual Orbit app lives. Set this to your deployed app's login
     URL (e.g. "https://app.example.com/login"); while empty, the Sign-in
     buttons fall back to the request-access section. */
  var APP_SIGNIN_URL = ''

  document.documentElement.classList.add('js')
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  document.querySelectorAll('[data-signin]').forEach(function (a) {
    a.setAttribute('href', APP_SIGNIN_URL || '#get-started')
  })

  /* ---------- Theme toggle (auto → manual override) ---------- */
  var toggle = document.getElementById('themeToggle')
  function isDark() {
    var forced = document.documentElement.getAttribute('data-theme')
    if (forced) return forced === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  function paintToggle() {
    toggle.textContent = isDark() ? '☀️' : '🌙'
    toggle.setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode')
  }
  toggle.addEventListener('click', function () {
    document.documentElement.setAttribute('data-theme', isDark() ? 'light' : 'dark')
    paintToggle()
  })
  paintToggle()

  /* ---------- Scroll: progress bar, header elevation, nav spy, to-top ---------- */
  var bar = document.getElementById('progress')
  var header = document.getElementById('siteHeader')
  var toTop = document.getElementById('toTop')
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.site-nav a'))
  var sections = navLinks
    .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)) })
    .filter(Boolean)
  function onScroll() {
    var doc = document.documentElement
    var max = doc.scrollHeight - window.innerHeight
    bar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%'
    header.classList.toggle('is-scrolled', window.scrollY > 8)
    toTop.classList.toggle('show', window.scrollY > 700)
    var current = ''
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].getBoundingClientRect().top <= 96) current = sections[i].id
    }
    navLinks.forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === '#' + current)
    })
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
  toTop.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
  })

  /* ---------- Scroll reveal ---------- */
  var revealEls = document.querySelectorAll('.reveal')
  if ('IntersectionObserver' in window && !reduced) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
      })
    }, { threshold: 0.1 })
    revealEls.forEach(function (el) { io.observe(el) })
  } else {
    revealEls.forEach(function (el) { el.classList.add('in') })
  }

  /* ---------- Count-up hero stats ---------- */
  function countUp(el) {
    var to = Number(el.getAttribute('data-to'))
    if (reduced) { el.textContent = to; return }
    var start = null
    function tick(ts) {
      if (!start) start = ts
      var p = Math.min((ts - start) / 900, 1)
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)))
      if (p < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
  var counters = document.querySelectorAll('.count')
  if ('IntersectionObserver' in window) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { countUp(e.target); cio.unobserve(e.target) }
      })
    }, { threshold: 0.4 })
    counters.forEach(function (el) { cio.observe(el) })
  } else {
    counters.forEach(function (el) { el.textContent = el.getAttribute('data-to') })
  }

  /* ---------- Feature filter ---------- */
  var filter = document.getElementById('featureFilter')
  var features = Array.prototype.slice.call(document.querySelectorAll('.feature'))
  var noMatch = document.getElementById('noFeatureMatch')
  filter.addEventListener('input', function () {
    var q = filter.value.trim().toLowerCase()
    var shown = 0
    features.forEach(function (card) {
      var hit = !q || card.textContent.toLowerCase().indexOf(q) !== -1
      card.classList.toggle('hidden', !hit)
      if (hit) shown++
    })
    noMatch.style.display = shown ? 'none' : 'block'
  })

  /* ---------- Role tabs ---------- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs [role="tab"]'))
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) {
        var on = t === tab
        t.setAttribute('aria-selected', on ? 'true' : 'false')
        document.getElementById(t.getAttribute('aria-controls')).classList.toggle('active', on)
      })
    })
  })

  /* ---------- Attendance demo (1 real second = 12 simulated minutes) ---------- */
  var SPEED = 720 // simulated seconds per real second
  var FULL_DAY = 8 * 3600
  var clock = document.getElementById('demoClock')
  var verdict = document.getElementById('demoVerdict')
  var btns = {
    checkIn: document.getElementById('dCheckIn'),
    pause: document.getElementById('dPause'),
    resume: document.getElementById('dResume'),
    checkOut: document.getElementById('dCheckOut'),
    reset: document.getElementById('dReset'),
  }
  var worked = 0, running = false, ticker = null
  function fmt(secs) {
    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60)
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m
  }
  function paint() {
    clock.textContent = fmt(worked)
    clock.className = running ? 'running' : (worked > 0 ? 'paused' : '')
  }
  function setButtons(state) {
    btns.checkIn.disabled = state !== 'idle'
    btns.pause.disabled = state !== 'running'
    btns.resume.disabled = state !== 'paused'
    btns.checkOut.disabled = state === 'idle' || state === 'done'
    btns.reset.disabled = state === 'idle'
  }
  function startTicker() {
    ticker = setInterval(function () { worked += SPEED; paint() }, 1000)
  }
  btns.checkIn.addEventListener('click', function () {
    worked = 0; running = true; verdict.textContent = ''
    setButtons('running'); startTicker(); paint()
  })
  btns.pause.addEventListener('click', function () {
    running = false; clearInterval(ticker); setButtons('paused'); paint()
    verdict.textContent = 'On a break — paused minutes never count as worked time.'
  })
  btns.resume.addEventListener('click', function () {
    running = true; setButtons('running'); startTicker(); paint()
    verdict.textContent = ''
  })
  btns.checkOut.addEventListener('click', function () {
    running = false; clearInterval(ticker); setButtons('done'); paint()
    var ok = worked >= FULL_DAY
    verdict.innerHTML = 'Day closed at <b>' + fmt(worked) + '</b> worked — verdict: ' +
      (ok ? '<span class="pill g">Present</span> (≥ 8 h recorded)'
          : '<span class="pill a">Auto-leave</span> (less than 8 h recorded)')
  })
  btns.reset.addEventListener('click', function () {
    running = false; clearInterval(ticker); worked = 0
    verdict.textContent = ''; setButtons('idle'); paint()
  })
  setButtons('idle'); paint()

  /* ---------- Leave balance calculator ---------- */
  var cType = document.getElementById('calcType')
  var cTaken = document.getElementById('calcTaken')
  var cDays = document.getElementById('calcDays')
  var cOut = document.getElementById('calcOut')
  var cBar = document.getElementById('calcBar')
  function calc() {
    var quota = Number(cType.value)
    var name = cType.options[cType.selectedIndex].getAttribute('data-name')
    var taken = Math.max(0, Number(cTaken.value) || 0)
    var days = Math.max(0, Number(cDays.value) || 0)
    var available = Math.max(0, quota - taken)
    var over = days > available
    var afterUse = Math.min(taken + days, quota)
    cBar.style.width = Math.min((afterUse / quota) * 100, 100) + '%'
    cBar.className = over ? 'over' : ''
    if (days === 0) {
      cOut.innerHTML = name + ': <b>' + available + '</b> of ' + quota + ' days available.'
    } else if (over) {
      cOut.innerHTML = '⚠️ That’s <b>' + days + '</b> day' + (days > 1 ? 's' : '') +
        ', but only <b>' + available + '</b> remain — the form blocks this and the server double-checks at approval time.'
    } else {
      cOut.innerHTML = '<b>' + days + '</b> day' + (days > 1 ? 's' : '') + ' requested · <b>' +
        (available - days) + '</b> of ' + quota + ' ' + name + ' days would remain after approval.'
    }
  }
  ;[cType, cTaken, cDays].forEach(function (el) { el.addEventListener('input', calc) })
  calc()

  /* ---------- Theme swatches (recolor page accents) ---------- */
  var swatches = document.getElementById('swatches')
  swatches.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-c]')
    if (!btn) return
    document.documentElement.style.setProperty('--primary', btn.getAttribute('data-c'))
    document.documentElement.style.setProperty('--primary-600', btn.getAttribute('data-h'))
    Array.prototype.forEach.call(swatches.children, function (b) {
      b.classList.toggle('active', b === btn)
    })
  })

  /* ---------- Footer year ---------- */
  document.getElementById('year').textContent = new Date().getFullYear()
})()
