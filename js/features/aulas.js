/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/aulas.js
 * Aulas PEF: catálogo fixo (AULAS_PEF), progresso do usuário
 * (coleção 'aulas'), detalhe em overlay e conclusão.
 *
 * NOTA: renderProntuario importada de prontuario.js (ciclo
 * window.* enquanto prontuario.js não é extraído (Fase 5).
 * Corpo movido verbatim.
 * ═══════════════════════════════════════════════════════════ */

import { db, query, collection, where, getDocs, addDoc } from '../core/firebase.js';
import { store } from '../core/store.js';
import { ir } from '../core/router.js';
import { toast, abrirOverlay, fecharOverlay } from '../utils/dom.js';
import { renderProntuario } from './prontuario.js';

// ════════════════════════════════════════════════
// FASE 3 — AULAS PEF
// ════════════════════════════════════════════════

const AULAS_PEF = [
  {
    num: 1, titulo: 'O que é educação financeira?',
    desc: 'Educação financeira é o conhecimento que ajuda a administrar o dinheiro de forma consciente, equilibrando gastos, poupando para o futuro e evitando dívidas.',
    tags: ['Mentalidade', 'Fundamentos'],
    videoId: 'MAQuyNDlXMY',
    reflexao: 'Qual é a sua relação emocional com o dinheiro? Você o vê como ferramenta ou como fonte de ansiedade?'
  },
  {
    num: 2, titulo: 'Estabeleça os seus objetivos',
    desc: 'Ter objetivos financeiros estabelecidos é essencial para direcionar seus esforços, evitar gastos desnecessários e alcançar metas de forma mais eficiente.',
    tags: ['Objetivos', 'Planejamento'],
    videoId: 'X2u96WDe-lY',
    reflexao: 'Você tem objetivos financeiros claros? Escreva agora os 3 principais que quer conquistar nos próximos anos.'
  },
  {
    num: 3, titulo: 'Conheça e controle seus gastos',
    desc: 'Conhecer e controlar seus gastos é fundamental para evitar desperdícios, manter o equilíbrio financeiro e alcançar suas metas com mais segurança.',
    tags: ['Orçamento', 'Controle'],
    videoId: 'qqv_X7UIR5Q',
    reflexao: 'Você sabe exatamente para onde vai cada real da sua renda? Liste as 3 principais despesas do último mês.'
  },
  {
    num: 4, titulo: 'Gestão de riscos pessoais',
    desc: 'A gestão de riscos pessoais é crucial para proteger suas finanças contra imprevistos, garantindo estabilidade e evitando prejuízos que comprometam seus objetivos.',
    tags: ['Proteção', 'Riscos'],
    videoId: 'n4YR7aOXo8Y',
    reflexao: 'Quais são os principais riscos financeiros na sua vida hoje? Você está protegido contra imprevistos?'
  },
  {
    num: 5, titulo: 'Crie a sua reserva de emergência',
    desc: 'Criar uma reserva de emergência é essencial para lidar com imprevistos financeiros sem comprometer seu orçamento ou objetivos de longo prazo.',
    tags: ['Reserva', 'Segurança'],
    videoId: 'qtUNTPVBd4g',
    reflexao: 'Você tem reserva de emergência? Quantos meses de gastos ela cobre atualmente?'
  },
  {
    num: 6, titulo: 'Invista',
    desc: 'Investir é essencial para fazer o dinheiro crescer, proteger seu poder de compra e alcançar objetivos financeiros de médio e longo prazo.',
    tags: ['Investimentos', 'Crescimento'],
    videoId: 'b4d8ZkGXBJU',
    reflexao: 'O que te impede de começar a investir hoje? Qual seria o primeiro passo que você poderia dar?'
  },
  {
    num: 7, titulo: 'Liberdade financeira',
    desc: 'A liberdade financeira é importante porque permite viver sem depender exclusivamente de um salário, garantindo segurança e escolhas para o futuro.',
    tags: ['Liberdade', 'Independência'],
    videoId: 'MsaRtq92dc4',
    reflexao: 'O que a liberdade financeira significa para você? Escreva em uma frase o seu "porquê" financeiro.'
  },
  {
    num: 8, titulo: 'Quais as opções para investir o seu dinheiro?',
    desc: 'As alternativas de investimento de forma simples e objetiva, desde renda fixa até renda variável.',
    tags: ['Investimentos', 'Opções'],
    videoId: 'k7FFCTbzaKQ',
    reflexao: 'Qual tipo de investimento mais combina com seu perfil e objetivo atual? Conservador, moderado ou arrojado?'
  },
  {
    num: 9, titulo: 'Minha trajetória com a educação financeira',
    desc: 'A trajetória de 2017 a 2025: como começar a organizar as finanças, como os aportes evoluem e quais mudanças são fundamentais para a construção de patrimônio.',
    tags: ['Trajetória', 'Inspiração'],
    videoId: 'f63GancxD7s',
    reflexao: 'Como está a sua trajetória financeira? O que mudou (ou precisa mudar) para você avançar para o próximo nível?'
  },
  {
    num: 10, titulo: 'A jornada é feita por curvas',
    desc: 'Como os gastos evoluem (e oscilam) ao longo de 3 anos — as categorias que mais consomem a receita e o que aprender nesse processo.',
    tags: ['Gastos', 'Evolução'],
    videoId: 'OQ_QqEeyl4g',
    reflexao: 'Olhando seus últimos 3 anos, sua situação financeira melhorou? Quais curvas você enfrentou?'
  },
  {
    num: 11, titulo: 'Migração do débito para o crédito',
    desc: 'Como migrar do crédito para o débito e como essa estratégia pode gerar um ganho financeiro mensal.',
    tags: ['Crédito', 'Estratégia'],
    videoId: 'A2jtrMTXo90',
    reflexao: 'Você usa mais débito ou crédito no dia a dia? Qual o impacto disso nas suas finanças mensais?'
  },
  {
    num: 12, titulo: 'Gastos evitáveis — Carro',
    desc: 'Como evitar gastos com manutenção corretiva do carro e as lições aprendidas rodando 18 mil quilômetros.',
    tags: ['Gastos', 'Veículo'],
    videoId: '-iZzrA_G14w',
    reflexao: 'Quais são os gastos evitáveis na sua vida que você ainda não eliminou? Qual deles você pode cortar agora?'
  }
];

async function getAulasConcluidas() {
  try {
    const q = query(collection(db,'aulas'), where('email','==',store.sessao.email));
    const snap = await getDocs(q); const r = {};
    snap.forEach(d => { const data = d.data(); r[data.aulaNum] = true; });
    return r;
  } catch(e) { return {}; }
}

async function renderAulas() {
  const concluidas = await getAulasConcluidas();
  const total = Object.keys(concluidas).length;
  const pct = Math.round((total / 12) * 100);

  // Progress circle
  const circunf = 138.2;
  document.getElementById('aula-prog-circle').style.strokeDashoffset = circunf - (circunf * pct / 100);
  document.getElementById('aula-prog-pct').textContent = pct + '%';
  document.getElementById('aulas-concluidas-count').textContent = total;
  document.getElementById('aulas-badge').style.display = total === 12 ? '' : 'none';

  const lista = document.getElementById('aulas-lista');
  lista.innerHTML = '';
  AULAS_PEF.forEach(aula => {
    const concluida = !!concluidas[aula.num];
    const div = document.createElement('div');
    div.className = 'aula-card' + (concluida ? ' concluida' : '');
    div.onclick = () => abrirAulaDetalhe(aula, concluida);
    div.innerHTML = `
      <div class="aula-num">Aula ${aula.num}</div>
      <div class="aula-titulo">${aula.titulo}</div>
      <div class="aula-desc">${aula.desc}</div>
      <div style="margin-top:8px" class="aula-tags">${aula.tags.map(t=>`<span class="aula-tag">${t}</span>`).join('')}</div>
    `;
    lista.appendChild(div);
  });
}

window.abrirAulas = async function() {
  ir('screen-aulas');
  await renderAulas();
};

function abrirAulaDetalhe(aula, concluida) {
  const html = `
    <div style="font-size:10px;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px">Aula ${aula.num} de 12</div>
    <div style="font-size:17px;font-weight:800;color:var(--text);line-height:1.3;margin-bottom:.375rem">${aula.titulo}</div>
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:.875rem;line-height:1.55">${aula.desc}</div>
    <div style="margin-bottom:.875rem;display:flex;gap:6px;flex-wrap:wrap">${aula.tags.map(t=>`<span class="aula-tag">${t}</span>`).join('')}</div>

    <div style="position:relative;width:100%;border-radius:14px;overflow:hidden;background:linear-gradient(135deg,#FF0000,#CC0000);margin-bottom:1.25rem;cursor:pointer" onclick="window.open('https://www.youtube.com/watch?v=${aula.videoId}','_blank')">
      <div style="display:flex;align-items:center;gap:14px;padding:1.25rem">
        <div style="width:52px;height:52px;background:rgba(255,255,255,.2);border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <div style="font-size:22px;margin-left:3px">▶</div>
        </div>
        <div>
          <div style="font-size:14px;font-weight:800;color:#fff">Assistir no YouTube</div>
          <div style="font-size:12px;color:rgba(255,255,255,.8);margin-top:2px">${aula.titulo}</div>
        </div>
      </div>
    </div>

    <div style="background:var(--amber-light);border-radius:12px;padding:12px 14px;border-left:3px solid var(--amber);margin-bottom:1.25rem">
      <div style="font-size:11px;font-weight:800;color:var(--amber);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">💭 Reflexão</div>
      <div style="font-size:13px;color:#7A4010;line-height:1.6">${aula.reflexao}</div>
    </div>

    <div style="display:grid;gap:.5rem">
      ${concluida
        ? `<div style="text-align:center;padding:.75rem;background:var(--eko-green-light);border-radius:12px;font-size:14px;font-weight:700;color:var(--eko-green-dark)">✅ Você já concluiu esta aula!</div>`
        : `<button class="btn btn-primary" onclick="marcarAulaConcluida(${aula.num})">✅ Marcar como concluída</button>`
      }
      <button class="btn" onclick="fecharOverlay('overlay-aula')">Fechar</button>
    </div>
  `;
  document.getElementById('aula-detail-content').innerHTML = html;
  abrirOverlay('overlay-aula');
}

window.marcarAulaConcluida = async function(num) {
  try {
    // Verificar se já existe
    const q = query(collection(db,'aulas'), where('email','==',store.sessao.email), where('aulaNum','==',num));
    const snap = await getDocs(q);
    if (snap.empty) {
      await addDoc(collection(db,'aulas'), { email:store.sessao.email, aulaNum:num, concluidaEm:new Date().toISOString() });
    }
  } catch(e) {
    console.error('marcarAulaConcluida — erro ao gravar no Firestore:', e);
    toast('❌ Erro ao registrar. Tente novamente.');
    return;
  }

  // Gravação confirmada — a partir daqui, falha é só de tela (não de dado)
  toast('✅ Aula concluída!');

  try {
    fecharOverlay('overlay-aula');
    await renderAulas();
    await renderProntuario();
  } catch(e) {
    console.error('marcarAulaConcluida — erro ao atualizar a tela:', e);
  }
};

export { getAulasConcluidas };
