// The machine's panel: controls of the machine viewer (game/scenes/machine_viewer.tscn) and the physical
// model at the viewer's instant — the phase of the cycle, pressures, valves, every pipe's flow and water
// speed, plots, the indicator diagram and the machine's summary. All numbers come from the machine's
// data (game/assets/machines/<id>/<id>.json), the same the game draws from.
//
// Used by the editor's «Машины» (editor/machines.js: the viewer in an iframe) and by the published page
// (3d assets/scripts/machines/publish_web.py: the viewer in the same window). No imports: the published
// page loads this file on its own. Styles: machine_panel.css (everything under .machine-panel).
//
//   const panel = createMachinePanel(aside, { send, readState, header, soundNote, isVisible })
//   panel.setData(data)          // the machine's JSON; the panel builds its views, summary, plots
//   send(cmd)                    // window.ggscapeMachineCommand(JSON.stringify(cmd)) of the viewer
//   readState()                  // JSON.parse(window.ggscapeMachineState) of the viewer, or null

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el[k] = v; else if (k === 'text') el.textContent = v; else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter(k => k != null && k !== false));
  return el;
};
const n = (v, d = 1) => v.toFixed(d).replace('.', ',');

export function createMachinePanel(aside, { send, readState, header = null, soundNote = '', isVisible = () => true } = {}) {
  let data = null;
  let state = null;
  let scrubbing = false;
  aside.classList.add('machine-panel');

  const title = h('h1', { class: 'mp-title' });
  const facts = h('div', { class: 'mp-facts' });
  // The phase box is as tall as its longest text: every text of the cycle sits in the same grid cell,
  // hidden, and the current one on top, so the panel below never jumps.
  const phaseNow = h('div', { class: 'mp-phase-now', 'aria-live': 'polite' });
  const phase = h('div', { class: 'mp-phase' }, phaseNow);
  const play = h('button', { class: 'mp-accent', text: '⏸', title: 'Пауза / пуск (Пробел в кадре)', onclick: () => send({ play: !(state?.playing ?? true) }) });
  const speeds = [0.05, 0.1, 0.25, 0.5, 1, 2];
  const speedSeg = h('div', { class: 'mp-seg mp-speeds' }, speeds.map(s => h('button', { 'data-speed': s, text: `×${String(s).replace('.', ',')}`,
    onclick: () => send({ speed: s }) })));
  const stepBack = h('button', { text: '◀', title: 'Кадр назад (1/60 с машины)', onclick: () => send({ play: false, step: -1 }) });
  const stepFwd = h('button', { text: '▶', title: 'Кадр вперёд', onclick: () => send({ play: false, step: 1 }) });
  const scrub = h('input', { type: 'range', min: 0, max: 1, step: 0.001, value: 0, 'aria-label': 'Время такта' });
  const clock = h('output', { class: 'mp-mono' });
  scrub.oninput = () => { scrubbing = true; send({ play: false, seek: +scrub.value * (data?.period ?? 1) }); };
  scrub.onchange = () => { scrubbing = false; };
  const section = h('input', { type: 'checkbox', onchange: () => send({ section: section.checked }) });
  const labels = h('input', { type: 'checkbox', checked: true, onchange: () => send({ labels: labels.checked }) });
  const fx = h('input', { type: 'checkbox', checked: true, onchange: () => send({ fx: fx.checked }) });
  const workers = h('input', { type: 'checkbox', onchange: () => send({ workers: workers.checked }) });
  // Sound: every part at its place, the whole machine heard from outside, or none.
  const soundModes = [['parts', 'По деталям'], ['whole', 'Целиком'], ['off', 'Выкл.']];
  const soundSeg = h('div', { class: 'mp-seg mp-sound' }, soundModes.map(([id, text]) => h('button', { 'data-sound': id, text,
    onclick: () => send({ sound: id }) })));
  const volume = h('input', { type: 'range', min: -40, max: 6, step: 1, value: 0, 'aria-label': 'Громкость машины, дБ' });
  const volumeOut = h('output', { class: 'mp-mono', text: '0 дБ' });
  volume.oninput = () => { volumeOut.textContent = `${volume.value} дБ`; send({ volume: +volume.value }); };
  const views = h('div', { class: 'mp-views' });
  const live = h('dl', { class: 'mp-dl' });
  const pipes = h('table', { class: 'mp-pipes' });
  const chart = h('canvas', { class: 'mp-chart', width: 700, height: 300, title: 'Щелчок — перейти к этому моменту такта' });
  const pv = h('canvas', { class: 'mp-pv', width: 700, height: 360 });
  const summary = h('dl', { class: 'mp-dl' });
  chart.onclick = e => {
    if (!data) return;
    const r = chart.getBoundingClientRect();
    send({ play: false, seek: (e.clientX - r.left) / r.width * data.period });
  };

  aside.append(
    h('section', {}, header, title, facts),
    h('section', {}, h('h2', { text: 'Сейчас' }), phase),
    h('section', {}, h('h2', { text: 'Время' }),
      h('div', { class: 'mp-transport' }, play, h('div', { class: 'mp-row' }, stepBack, stepFwd, clock)), scrub, speedSeg),
    h('section', {}, h('h2', { text: 'Вид' }),
      h('label', { class: 'mp-check' }, section, 'Разрез по оси машины'),
      h('label', { class: 'mp-check' }, labels, 'Подписи деталей (буквы чертежа)'),
      h('label', { class: 'mp-check' }, fx, 'Вода, пар, огонь'),
      h('label', { class: 'mp-check' }, workers, 'Гоблины на угольном дворе'), views,
      h('p', { class: 'mp-note', text: 'Мышь в кадре: левая кнопка — вращать, правая или Shift + левая — сдвигать, колесо — приближать. Клавиши: Пробел — пауза, X — разрез, L — подписи, − и = — скорость, V — следующий вид.' })),
    h('section', {}, h('h2', { text: 'Звук' }), soundSeg,
      h('div', { class: 'mp-slider' }, h('label', { text: 'Громкость' }), volumeOut, volume),
      h('p', { class: 'mp-note', text: 'Браузер включает звук после щелчка по кадру. «По деталям» — каждый узел на своём месте (огонь, кипение, пар, вода, удары тумблера, клапаны, скрип балансира, цепи), громкость петель — по расходам цикла; «целиком» — вся машина снаружи.' + (soundNote ? ' ' + soundNote : '') })),
    h('section', {}, h('h2', { text: 'Модель в этот момент' }), live),
    h('section', {}, h('h2', { text: 'Трубы: расход и скорость воды' }), pipes,
      h('p', { class: 'mp-note', text: 'Скорость — расход, делённый на сечение трубы: полосы в воде на разрезе движутся ровно с ней (их сдвиг — интеграл скорости по времени).' })),
    h('section', {}, h('h2', { text: 'Такт' }), chart,
      h('p', { class: 'mp-note', text: 'Ход поршня, давление под ним и инжекция за один такт; линия — текущий момент.' })),
    h('section', {}, h('h2', { text: 'Индикаторная диаграмма' }), pv,
      h('p', { class: 'mp-note', text: 'Давление под поршнем против объёма: площадь петли — работа атмосферы за ход.' })),
    h('section', {}, h('h2', { text: 'Машина' }), summary),
    h('section', {}, h('h2', { text: 'Как это анимировано' }), h('div', { class: 'mp-note mp-how' },
      h('p', { text: 'Механика — ключи Blender из физической модели цикла (балансир, цепи на дугах, клапанный механизм Бейтона с тумблером, клапаны).' }),
      h('p', { text: 'Вода — расходы и уровни из гидравлической модели (Бернулли, Дарси, водосливы, Маннинг); шейдер двигает воду в трубах со скоростью расход/сечение, уровни — ключи, струи и капли — баллистика с начальной скоростью из модели.' }),
      h('p', { text: 'Пар настоящий прозрачен: дымка в цилиндре показывает его плотность; видимый пар снаружи — облака конденсата (сниффер, горячий колодец).' }),
      h('p', { text: 'Огонь — процедурные языки пламени, тлеющий уголь и мерцающий свет.' }))),
  );

  // ------------------------------------------------------------------- data
  const ch = (name, t) => {
    const a = data.channels[name];
    if (!a) return 0;
    const f = ((t % data.period) + data.period) % data.period * data.fps;
    const i0 = Math.floor(f) % data.frames;
    const i1 = (i0 + 1) % data.frames;
    return a[i0] + (a[i1] - a[i0]) * (f - Math.floor(f));
  };
  const maxOf = name => Math.max(...data.channels[name].map(Math.abs));

  function setData(d) {
    data = d;
    pvBase = null;
    lastPhase = '';
    if (!data) {
      title.textContent = '';
      facts.textContent = '';
      return;
    }
    const s = data.summary;
    title.textContent = data.title;
    facts.textContent = `${n(s.strokes_per_min)} ходов/мин · такт ${n(data.period, 2)} с · ход ${n(s.stroke_m, 2)} м · ${n(s.indicated_kw)} кВт`;
    views.replaceChildren(...Object.entries(data.views ?? {}).map(([id, v]) => h('button', { 'data-view': id, text: v.title, onclick: () => send({ view: id }) })));
    renderSummary();
    sizePhase();
    drawPV();
  }

  function renderSummary() {
    const s = data.summary;
    const rows = [
      ['Ходов в минуту', n(s.strokes_per_min)], ['Такт', `${n(s.period_s, 2)} с`], ['Ход поршня', `${n(s.stroke_m, 2)} м`],
      ['Наибольшая скорость поршня', `${n(s.piston_speed_max, 2)} м/с`],
      ['Давление под поршнем', `${n(s.p_min_kpa)}…${n(s.p_max_kpa)} кПа абс.`],
      ['Среднее индикаторное давление', `${n(s.mep_kpa)} кПа (${n(s.mep_kpa / 6.895)} psi)`],
      ['Индикаторная мощность', `${n(s.indicated_kw, 2)} кВт (${n(s.indicated_kw / 0.7457)} л. с.)`],
      ['Полезная (вода наверх)', `${n(s.water_kw, 2)} кВт`],
      ['Насос: за ход', `${n(s.pump_l_per_stroke)} л с ${n(s.pump_lift_m)} м`], ['Насос K: за ход', `${n(s.jack_l_per_stroke)} л`],
      ['Пар за ход', `${n(s.steam_kg_per_stroke, 3)} кг — ${n(s.steam_vs_swept, 1)}× объёма цилиндра`],
      ['Инжекция за ход', `${n(s.injection_l, 2)} л, струя до ${n(s.jet_speed_max)} м/с`],
      ['Через сниффер', `${n(s.snift_g)} г за ход`], ['Горячий колодец', `${n(s.hotwell_c)} °C`],
      ['Котёл', `+${n(s.boiler_kpa_over, 1)} кПа над атмосферой`], ['Топка', `${Math.round(s.boiler_kw)} кВт, уголь ${Math.round(s.coal_kg_per_h)} кг/ч`],
      ['КПД', `${n(s.efficiency * 100, 2)} %`],
    ];
    summary.replaceChildren(...rows.flatMap(([a, b]) => [h('dt', { text: a }), h('dd', { text: b })]));
  }

  function phaseText(t) {
    const reg = ch('reg', t), inj = ch('inj', t), v = ch('v', t), x = ch('x', t), sn = ch('m_sn', t), out = ch('q_out', t);
    if (inj > 0.05 && v < -0.05) return ['Рабочий ход', 'Струя холодной воды конденсирует пар, под поршнем разрежение: атмосфера давит поршень вниз, балансир поднимает штанги — насосы поднимают воду из шахты и в бак инжекции.'];
    if (inj > 0.05) return ['Впрыск', 'Тумблер опрокинулся у верха хода: регулятор закрыт, кран N открыт. Струя бьёт в поршень снизу и рассыпается дождём, давление падает.'];
    if (reg > 0.05 && v > 0.03) return ['Подъём поршня', 'Пар из котла заполняет цилиндр при давлении около атмосферного; поршень поднимают вес насосных штанг — пар лишь не даёт атмосфере помешать.'];
    if (reg > 0.05) return ['Впуск пара', `Тумблер внизу: кран инжекции закрыт, регулятор открыт. Пар греет стенки (часть его тут же конденсируется)${sn > 1e-4 ? ', сниффер выпускает воздух' : ''}${out > 1e-5 ? ', вода уходит по эдукционной трубе в горячий колодец' : ''}.`];
    if (v < -0.05) return ['Конец рабочего хода', 'Палец штока толкает рог тумблера вниз: инжекция перекрывается, вот-вот откроется пар.'];
    return ['Переход', x > 1.0 ? 'Поршень наверху: тумблер переваливается, регулятор закрывается.' : 'Поршень внизу.'];
  }

  function sizePhase() {
    const texts = new Map();
    for (let i = 0; i < data.frames; i++) {
      const [a, b] = phaseText(i / data.fps);
      texts.set(a + b, [a, b]);
    }
    phase.replaceChildren(...[...texts.values()].map(([a, b]) => h('div', { class: 'mp-phase-size', 'aria-hidden': 'true' },
      h('b', { text: a }), h('p', { text: b }))), phaseNow);
  }

  function renderLive(t) {
    const p = ch('p', t), pb = ch('p_b', t), v = ch('v', t), x = ch('x', t);
    const force = (101325 - p) * Math.PI * 0.25 * data.geometry.bore ** 2 / 1000;
    const rows = [
      ['Поршень', `${n(x, 2)} м от низа, ${v >= 0 ? '↑' : '↓'} ${n(Math.abs(v), 2)} м/с`],
      ['Под поршнем', `${n(p / 1000)} кПа (${p < 101325 ? 'разрежение ' + n((101325 - p) / 1000) + ' кПа' : 'избыток ' + n((p - 101325) / 1000, 2) + ' кПа'})`],
      ['Пар / воздух', `${n(ch('p_s', t) / 1000)} / ${n(ch('p_a', t) / 1000, 2)} кПа, пар ${n(ch('rho_steam', t), 3)} кг/м³`],
      ['Котёл', `${n((pb - 101325) / 1000, 2)} кПа над атмосферой`],
      ['Регулятор C / кран N', `${Math.round(ch('reg', t) * 100)} % / ${Math.round(ch('inj', t) * 100)} %`],
      ['Сила атмосферы', `${n(Math.abs(force), 1)} кН ${force >= 0 ? 'вниз' : 'вверх'} (разность давлений на поршне)`],
      ['Стенка цилиндра', `${n(ch('t_w', t))} °C, вода на дне ${n(ch('t_pool', t))} °C, слой ${n(ch('h_pool', t) * 1000)} мм`],
      ['Сниффер', ch('m_sn', t) > 1e-5 ? `${n(ch('m_sn', t) * 1000)} г/с, ${n(ch('v_sn', t))} м/с` : 'закрыт'],
      ['Струя инжекции', ch('q_inj', t) > 1e-6 ? `${n(ch('q_inj', t) * 1000, 2)} л/с, ${n(ch('v_jet', t))} м/с` : 'нет'],
    ];
    live.replaceChildren(...rows.flatMap(([a, b]) => [h('dt', { text: a }), h('dd', { text: b })]));
  }

  function renderPipes(t) {
    if (!pipes.rows.length) {
      pipes.append(h('thead', {}, h('tr', {}, h('td', { text: 'Труба' }), h('td', { text: 'Ø, мм' }), h('td', { text: 'л/с' }), h('td', { text: 'м/с' }), h('td', { text: 'макс.' }))));
      pipes.append(h('tbody'));
    }
    const body = pipes.tBodies[0];
    const list = Object.entries(data.fluids).filter(([, f]) => f.kind === 'pipe' || f.kind === 'steam_pipe');
    body.replaceChildren(...list.map(([name, f]) => {
      const p = data.pipes[f.pipe];
      let area = Math.PI * 0.25 * p.d * p.d;
      if (name === 'W_main') area -= Math.PI * 0.25 * 0.06 * 0.06;
      const u = ch(f.flow, t);
      const steam = f.kind === 'steam_pipe';
      const q = steam ? null : u * area * 1000;
      const part = name.startsWith('W_inj_') ? { W_inj_top: ' (весь поток)', W_inj_mid: ' (за O)', W_inj_low: ' (к крану)' }[name] : '';
      return h('tr', { class: Math.abs(u) > 1e-3 ? 'on' : '' },
        h('td', {}, h('b', { text: p.letter ? p.letter + ' ' : '' }), p.name + part),
        h('td', { text: String(Math.round(p.d * 1000)) }),
        h('td', { text: steam ? (name === 'S_neck' ? n(ch('m_reg', t) * 1000) + ' г/с' : n(ch('m_sn', t) * 1000) + ' г/с') : n(q, 2) }),
        h('td', { text: n(u, 2) }),
        h('td', { class: 'mp-muted', text: n(maxOf(f.flow), 1) }));
    }));
  }

  function drawChart(t) {
    const g = chart.getContext('2d');
    const W = chart.width, H = chart.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#1b1e23';
    g.fillRect(0, 0, W, H);
    const series = [['x', '#e8a33d', 'ход, м'], ['p', '#5b8cff', 'давление'], ['q_inj', '#3ccb8c', 'инжекция'], ['reg', '#f0645a', 'регулятор']];
    const N = data.frames;
    series.forEach(([name, color, label], si) => {
      const a = data.channels[name];
      const lo = Math.min(...a), hi = Math.max(...a);
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < N; i++) {
        const X = i / N * W;
        const Y = H - 18 - (a[i] - lo) / (hi - lo || 1) * (H - 40);
        i ? g.lineTo(X, Y) : g.moveTo(X, Y);
      }
      g.stroke();
      g.fillStyle = color;
      g.font = '22px "IBM Plex Mono", ui-monospace, monospace';
      g.fillText(label, 10 + si * 170, 24);
    });
    const X = (t / data.period) * W;
    g.strokeStyle = '#e6e3dc';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(X, 30); g.lineTo(X, H); g.stroke();
  }

  let pvBase = null;
  function drawPV(t) {
    const g = pv.getContext('2d');
    const W = pv.width, H = pv.height;
    const A = Math.PI * 0.25 * data.geometry.bore ** 2;
    const x = data.channels.x, p = data.channels.p;
    const vols = x.map(v => A * (0.2 + v));
    const v0 = Math.min(...vols), v1 = Math.max(...vols);
    const p1 = 110000;
    const X = v => 40 + (v - v0) / (v1 - v0) * (W - 60);
    const Y = q => H - 30 - q / p1 * (H - 50);
    if (!pvBase) {
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#1b1e23'; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#2e333a'; g.lineWidth = 1;
      for (let q = 0; q <= p1; q += 20000) { g.beginPath(); g.moveTo(40, Y(q)); g.lineTo(W - 20, Y(q)); g.stroke(); }
      g.strokeStyle = '#8f949c'; g.setLineDash([6, 6]);
      g.beginPath(); g.moveTo(40, Y(101325)); g.lineTo(W - 20, Y(101325)); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#8f949c'; g.font = '20px "IBM Plex Mono", ui-monospace, monospace';
      g.fillText('атм.', W - 70, Y(101325) - 6);
      g.fillText('0', 14, Y(0)); g.fillText('100 кПа', 46, Y(100000) - 6);
      g.fillText('объём под поршнем →', W - 260, H - 6);
      g.strokeStyle = '#5b8cff'; g.lineWidth = 2.5;
      g.beginPath();
      vols.forEach((v, i) => i ? g.lineTo(X(v), Y(p[i])) : g.moveTo(X(v), Y(p[i])));
      g.closePath(); g.stroke();
      pvBase = g.getImageData(0, 0, W, H);
    } else {
      g.putImageData(pvBase, 0, 0);
    }
    if (t != null) {
      g.fillStyle = '#e8a33d';
      g.beginPath(); g.arc(X(A * (0.2 + ch('x', t))), Y(ch('p', t)), 8, 0, Math.PI * 2); g.fill();
    }
  }

  // ------------------------------------------------------------------- loop
  let lastPhase = '';
  let frameNo = 0;
  function tick() {
    if (isVisible() && data && (frameNo++ % 3 === 0)) {
      state = readState();
      if (state?.ready) {
        const t = state.cycle;
        play.textContent = state.playing ? '⏸' : '▶';
        clock.textContent = `${n(t, 2)} / ${n(data.period, 2)} с`;
        if (!scrubbing) scrub.value = t / data.period;
        speedSeg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(Math.abs(+b.dataset.speed - state.speed) < 1e-6)));
        views.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
        section.checked = state.section; labels.checked = state.labels; fx.checked = state.fx; workers.checked = !!state.workers;
        soundSeg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sound === state.sound)));
        const [ph, text] = phaseText(t);
        if (ph + text !== lastPhase) {
          phaseNow.replaceChildren(h('b', { text: ph }), h('p', { text }));
          lastPhase = ph + text;
        }
        renderLive(t);
        renderPipes(t);
        drawChart(t);
        drawPV(t);
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return { setData, state: () => state, data: () => data, send };
}
