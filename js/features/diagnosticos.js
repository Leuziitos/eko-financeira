/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/diagnosticos.js
 * Diagnósticos financeiros: bancos de perguntas (Ciclo 30q em
 * 2 partes com pontuação invertida, Independência 15q, Casal
 * 20q com N/A), quiz engine, resultado, prazos de refazimento
 * e limite de tentativas (coleção 'diagnosticos').
 * renderHub/renderProntuario via pontes window.* até a Fase 5.
 * Corpo movido verbatim; ordem original das faixas preservada.
 * ═══════════════════════════════════════════════════════════ */

import { db, query, collection, where, getDocs, addDoc } from '../core/firebase.js';
import { store, cache } from '../core/store.js';
import { ir } from '../core/router.js';
import { logEko } from '../core/firebase.js';
import { esc, diasAte } from '../utils/format.js';
import { renderProntuario } from './prontuario.js';
import { renderHub } from './hub.js';

async function getDiags(email) {
  if (cache.diagnosticos) return cache.diagnosticos;
  try {
    const q = query(collection(db,'diagnosticos'), where('email','==',email));
    const snap = await getDocs(q); const r = [];
    snap.forEach(d => r.push({...d.data(), _id:d.id}));
    r.sort((a,b) => (a.criadoEm||'') > (b.criadoEm||'') ? -1 : 1);
    cache.diagnosticos = r;
    return cache.diagnosticos;
  } catch(e) { console.error('getDiags error:', e); return []; }
}
async function saveDiag(data) {
  data.email = store.sessao.email;
  data.criadoEm = new Date().toISOString();
  // Conta quantas vezes já refez dentro do prazo atual
  const existentes = await getDiags(store.sessao.email);
  const ultimo = existentes.find(d => d.tipo === data.tipo);
  if (ultimo) {
    const cfg = DIAGS_CONFIG.find(c => c.tipo === data.tipo);
    const prox = new Date(ultimo.criadoEm); prox.setMonth(prox.getMonth() + (cfg?.meses||3));
    const dentroDoP = new Date() < prox;
    data.tentativas = dentroDoP ? (ultimo.tentativas || 0) + 1 : 0;
  } else {
    data.tentativas = 0;
  }
  await addDoc(collection(db,'diagnosticos'), data);
  cache.invalidar('diagnosticos');
}

// ── DIAGNÓSTICOS ──────────────────────────────────────────────
const DIAGS_CONFIG = [
  {tipo:'ciclo', icon:'🔄', nome:'Ciclo Financeiro', desc:'30 perguntas em 2 partes — descubra em qual ciclo você está', meses:3, cor:'var(--eko-green)'},
  {tipo:'independencia', icon:'💰', nome:'Independência Financeira', desc:'15 perguntas — descubra o quanto está preparado para se aposentar', meses:3, cor:'var(--eko-blue-mid)'},
  {tipo:'casal', icon:'👫', nome:'Finanças a Dois', desc:'20 perguntas — avalie a saúde financeira do casal', meses:6, cor:'var(--purple)'}
];

async function renderDiagnosticos() {
  const diags = await getDiags(store.sessao.email);
  const el = document.getElementById('diag-cards');
  el.innerHTML = DIAGS_CONFIG.map(cfg => {
    const ultimo = diags.find(d => d.tipo === cfg.tipo);
    let status = '', bloqueado = false;

    if (ultimo) {
      const prox = new Date(ultimo.criadoEm); prox.setMonth(prox.getMonth() + cfg.meses);
      const dias = diasAte(prox.toISOString());
      const tentativas = ultimo.tentativas || 0; // quantas vezes já refez
      const limiteTentativas = tentativas >= 2;

      const res = ultimo.resultado||'';
      const badgeClass = (res.includes('Expansão')||res.includes('Referência')||res.includes('Saudável')||res.includes('Acima')) ? 'badge-green' : (res.includes('Equilíbrio')||res.includes('Construção')||res.includes('Comum')) ? 'badge-amber' : 'badge-red';
      status = `<div style="margin-top:8px"><span class="badge ${badgeClass}">${ultimo.resultado}</span></div>`;

      if (dias > 0) {
        // Dentro do prazo — pode refazer até 2x, mas avisa
        if (limiteTentativas) {
          status += `<div style="font-size:12px;color:var(--text-muted);margin-top:6px">🔒 Limite de refações atingido · Liberado em ${dias} dias</div>`;
          bloqueado = true;
        } else {
          const restam = 2 - tentativas;
          status += `<div style="font-size:12px;color:var(--amber);margin-top:6px">🔄 Pode refazer (${restam} vez${restam>1?'es':''} restante${restam>1?'s':''}) · Prazo: ${dias} dias</div>`;
        }
      } else {
        // Fora do prazo — liberado normalmente, zera contagem de tentativas
        status += `<div style="font-size:12px;color:var(--eko-green);margin-top:6px">✅ Disponível para refazer</div>`;
      }
    }

    const podeIniciar = !bloqueado;
    const btnTxt = ultimo ? 'Refazer diagnóstico' : 'Iniciar diagnóstico';

    return `<div class="card card-accent" style="cursor:${podeIniciar?'pointer':'default'}" onclick="${podeIniciar?'iniciarQuiz(\''+cfg.tipo+'\')':''}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
        <div style="font-size:32px">${cfg.icon}</div>
        ${podeIniciar?`<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();iniciarQuiz('${cfg.tipo}')">${btnTxt}</button>`:''}
      </div>
      <div style="font-size:16px;font-weight:800;margin:.5rem 0 2px">${cfg.nome}</div>
      <div style="font-size:13px;color:var(--text-muted)">${cfg.desc}</div>
      <div style="font-size:12px;color:var(--text-hint);margin-top:4px">Intervalo: ${cfg.meses} meses</div>
      ${status}
    </div>`;
  }).join('');
}

window.voltarDiagnosticos = async function() { await renderDiagnosticos(); ir('screen-diagnosticos'); };

async function finalizarQuiz() {
  let pontos = 0;
  quizPergs.forEach((q, i) => {
    const r = quizRespostas[i];
    if(quizTipo === 'ciclo') {
      if(q.parte === 1) pontos += r === 'sim' ? 1 : -1;
      else pontos += r === 'nao' ? 1 : -1;
    } else if(quizTipo === 'independencia') {
      pontos += r === 'sim' ? 1 : -1;
    } else {
      if(r === 'sim') pontos += 1;
      else if(r === 'nao') pontos -= 1;
    }
  });

  let resultado = '';
  if(quizTipo === 'ciclo') {
    resultado = pontos >= 11 ? 'Ciclo de Expansão' : pontos >= -10 ? 'Ciclo de Equilíbrio' : 'Ciclo de Atenção';
  } else if(quizTipo === 'independencia') {
    resultado = pontos >= 14 ? 'Referência' : pontos >= 11 ? 'Acima da Média' : pontos >= 6 ? 'Caminho Comum' : 'Ponto de Partida';
  } else {
    resultado = pontos >= 8 ? 'Relação Saudável' : pontos >= -7 ? 'Em Construção' : 'Diálogo Iniciante';
  }

  await saveDiag({tipo: quizTipo, pontos, resultado, respostas: quizRespostas});
  logEko('diagnostico_concluido', { tipo: quizTipo, resultado });
  await renderResultado(quizTipo, pontos, resultado);
  await renderHub();
  await renderProntuario();
  ir('screen-resultado');
}

window.abrirDiagnosticos=async function(){try{await renderDiagnosticos();}catch(e){console.error(e);}ir('screen-diagnosticos');};
// ════════════════════════════════════════════════
// QUIZ ENGINE
// ════════════════════════════════════════════════
let quizTipo='', quizPergs=[], quizIdx=0, quizRespostas=[];

const PERGUNTAS_CICLO=[
  {p:'Você consegue identificar rapidamente quais são suas principais prioridades de vida, além da família?',cat:'Clareza e Propósito',parte:1},
  {p:'Você tem pelo menos três objetivos concretos que deseja alcançar nos próximos cinco anos?',cat:'Clareza e Propósito',parte:1},
  {p:'Você está satisfeito com seu estilo de vida e com o quanto consome hoje?',cat:'Clareza e Propósito',parte:1},
  {p:'Você tem uma meta financeira clara para conquistar até o fim deste ano?',cat:'Finanças',parte:1},
  {p:'Seu patrimônio ou reserva financeira tem crescido de forma consistente nos últimos dois anos?',cat:'Finanças',parte:1},
  {p:'Suas contas estão sempre em dia?',cat:'Finanças',parte:1},
  {p:'Se você ou seu parceiro faltasse hoje, seus dependentes conseguiriam se manter por pelo menos três anos?',cat:'Finanças',parte:1},
  {p:'Você sabe aproximadamente quando poderá se aposentar?',cat:'Finanças',parte:1},
  {p:'Você acredita que conseguirá manter seu padrão de vida na aposentadoria sem depender de outras pessoas?',cat:'Finanças',parte:1},
  {p:'Você se sente satisfeito com o equilíbrio entre trabalho, lazer e vida pessoal?',cat:'Tempo e Rotina',parte:1},
  {p:'Sua rotina diária é organizada, sem a sensação constante de apagar incêndios?',cat:'Tempo e Rotina',parte:1},
  {p:'Você consegue eliminar da sua agenda compromissos que não agregam valor à sua vida?',cat:'Tempo e Rotina',parte:1},
  {p:'Você sabe com clareza o que precisa fazer nos próximos três dias?',cat:'Tempo e Rotina',parte:1},
  {p:'Quando planeja suas tarefas do dia, você consegue concluir a maior parte do que planejou?',cat:'Tempo e Rotina',parte:1},
  {p:'Você se sente seguro ao tomar decisões importantes na sua vida?',cat:'Decisões e Carreira',parte:1},
  {p:'Você sente satisfação e engajamento no trabalho que realiza?',cat:'Decisões e Carreira',parte:1},
  {p:'Sua formação atual é suficiente para o que você quer estar fazendo nos próximos dois anos?',cat:'Decisões e Carreira',parte:1},
  {p:'Sua saúde pode ser considerada boa para a sua faixa etária?',cat:'Saúde',parte:1},
  {p:'Você pratica atividade física com regularidade?',cat:'Saúde',parte:1},
  {p:'Você mantém uma alimentação que considera saudável?',cat:'Saúde',parte:1},
  {p:'Você costuma sentir inveja quando pessoas ao seu redor conquistam algo importante?',cat:'Comportamento e Mentalidade',parte:2},
  {p:'Você acredita que tem menos sorte do que a maioria das pessoas?',cat:'Comportamento e Mentalidade',parte:2},
  {p:'Quando um plano não sai como esperado, você tende a descontar a frustração em quem está por perto?',cat:'Comportamento e Mentalidade',parte:2},
  {p:'Você sente frequentemente que não tem tempo suficiente para si mesmo, para seu relacionamento ou para seus filhos?',cat:'Comportamento e Mentalidade',parte:2},
  {p:'Você atribui ao trabalho ou à correria do dia a dia o fato de ainda não ter alcançado seus objetivos mais importantes?',cat:'Comportamento e Mentalidade',parte:2},
  {p:'Você costuma se sentir desanimado no início da semana ou triste no final do domingo?',cat:'Emoções e Estresse',parte:2},
  {p:'Você apresenta sinais frequentes de estresse no cotidiano?',cat:'Emoções e Estresse',parte:2},
  {p:'Suas dívidas têm aumentado nos últimos meses a ponto de te preocupar?',cat:'Finanças Negativas',parte:2},
  {p:'Quando alguém de confiança aponta algo que você precisa mudar, você tende a resistir?',cat:'Abertura e Equilíbrio',parte:2},
  {p:'Quando está longe do trabalho, você se sente inquieto ou improdutivo?',cat:'Abertura e Equilíbrio',parte:2}
];
const PERGUNTAS_INDEP=[
  {p:'Quando você pensa na sua independência financeira ou aposentadoria, sente mais confiança do que preocupação?',cat:'Mentalidade e Clareza'},
  {p:'Você tem um controle claro e atualizado da sua situação financeira hoje?',cat:'Mentalidade e Clareza'},
  {p:'Independentemente da fase da vida em que está, você reserva parte da sua renda regularmente?',cat:'Mentalidade e Clareza'},
  {p:'Seu patrimônio atual está crescendo na proporção que você considera adequada para sua idade?',cat:'Patrimônio e Previdência'},
  {p:'Você contribui para alguma forma de previdência, seja pública ou privada?',cat:'Patrimônio e Previdência'},
  {p:'Existe alguma perspectiva de herança ou recebimento futuro que faz parte do seu planejamento?',cat:'Patrimônio e Previdência'},
  {p:'Se necessário, você teria condições de continuar trabalhando por mais tempo sem que isso fosse um problema?',cat:'Patrimônio e Previdência'},
  {p:'Você dedica tempo regularmente para aprender sobre investimentos ou finanças?',cat:'Educação e Renda'},
  {p:'Você já tem ou está construindo planos para ter uma fonte de renda própria além do emprego atual?',cat:'Educação e Renda'},
  {p:'Você possui habilidades ou conhecimentos que poderiam gerar renda de formas alternativas à sua carreira principal?',cat:'Educação e Renda'},
  {p:'Você conversa abertamente com seu parceiro ou família sobre planos de longo prazo e aposentadoria?',cat:'Relacionamentos e Vida Pessoal'},
  {p:'Você mantém relacionamentos e amizades que vão além do seu círculo profissional?',cat:'Relacionamentos e Vida Pessoal'},
  {p:'Sua vida pessoal e familiar é tão satisfatória quanto — ou mais do que — sua vida profissional?',cat:'Relacionamentos e Vida Pessoal'},
  {p:'Você teria como manter seu plano de saúde ou acesso à saúde de qualidade mesmo se parasse de trabalhar?',cat:'Saúde e Futuro'},
  {p:'Você tem uma visão clara de como quer viver após conquistar sua independência financeira?',cat:'Saúde e Futuro'}
];
const PERGUNTAS_CASAL=[
  {p:'Nos últimos seis meses, vocês conversaram sobre o que cada um precisa para se sentir mais realizado?',cat:'Sonhos e Objetivos',opcoes:true},
  {p:'Vocês estão fazendo algum esforço conjunto para alcançar um objetivo financeiro importante?',cat:'Sonhos e Objetivos',opcoes:true},
  {p:'Você sabe qual é o maior sonho do seu parceiro na vida?',cat:'Sonhos e Objetivos',opcoes:true},
  {p:'Vocês reservam um momento regular, ao menos uma vez por mês, para conversar sobre as finanças da família?',cat:'Rotina Financeira',opcoes:true},
  {p:'Ambos conhecem a renda total que entra no lar, ao menos aproximadamente?',cat:'Rotina Financeira',opcoes:true},
  {p:'Ambos têm clareza sobre o patrimônio conjunto que possuem hoje?',cat:'Rotina Financeira',opcoes:true},
  {p:'Existe transparência total sobre como cada um usa o próprio dinheiro?',cat:'Rotina Financeira',opcoes:true},
  {p:'Filhos pequenos (até 10 anos) sabem que os pais conversam regularmente sobre dinheiro?',cat:'Filhos e Educação Financeira',opcoes:true},
  {p:'Filhos mais velhos (acima de 10 anos) são envolvidos nas discussões financeiras da família?',cat:'Filhos e Educação Financeira',opcoes:true},
  {p:'As regras sobre como os filhos lidam com dinheiro são decididas em conjunto pelo casal?',cat:'Filhos e Educação Financeira',opcoes:true},
  {p:'Vocês já conversaram sobre o que aconteceria financeiramente se um dos dois falecesse?',cat:'Cenários Difíceis',opcoes:true},
  {p:'Existe um plano claro para preservar o padrão de vida da família em caso de falecimento de um dos parceiros?',cat:'Cenários Difíceis',opcoes:true},
  {p:'Existe um plano definido para o caso de desemprego de um dos dois?',cat:'Cenários Difíceis',opcoes:true},
  {p:'Vocês já conversaram sobre o que fariam se recebessem um dinheiro inesperado?',cat:'Cenários Difíceis',opcoes:true},
  {p:'Existe um acordo sobre como agir caso um valor inesperado chegue para a família?',cat:'Cenários Difíceis',opcoes:true},
  {p:'Em algum momento, vocês conversaram sobre como lidariam financeiramente em caso de separação?',cat:'Cenários Difíceis',opcoes:true},
  {p:'Você conhece os hábitos e a situação financeira da família do seu parceiro?',cat:'Família e Círculo Social',opcoes:true},
  {p:'Ambos sabem o que as respectivas famílias pensam sobre as escolhas financeiras de vocês?',cat:'Família e Círculo Social',opcoes:true},
  {p:'As contas do casal têm algum nível de organização conjunta?',cat:'Família e Círculo Social',opcoes:true},
  {p:'Vocês costumam conversar com amigos sobre investimentos, conquistas ou planos financeiros?',cat:'Família e Círculo Social',opcoes:true}
];

window.iniciarQuiz=function(tipo){
  quizTipo=tipo;quizIdx=0;quizRespostas=[];
  quizPergs=tipo==='ciclo'?PERGUNTAS_CICLO:tipo==='independencia'?PERGUNTAS_INDEP:PERGUNTAS_CASAL;
  const cfg=DIAGS_CONFIG.find(d=>d.tipo===tipo);
  document.getElementById('quiz-titulo').textContent=cfg.nome;
  renderQuizQ();ir('screen-quiz');
};

function renderQuizQ(){
  const q=quizPergs[quizIdx];const total=quizPergs.length;
  const pct=Math.round((quizIdx/total)*100);
  document.getElementById('quiz-counter').textContent=(quizIdx+1)+' de '+total;
  document.getElementById('quiz-prog').style.width=pct+'%';
  document.getElementById('quiz-cat').textContent=q.cat;
  document.getElementById('quiz-q').textContent=q.p;
  let parteInfo='';
  if(quizTipo==='ciclo'){parteInfo=q.parte===1?'📌 Parte 1 — SIM vale +1 ponto, NÃO vale -1 ponto':'📌 Parte 2 — NÃO vale +1 ponto, SIM vale -1 ponto (lógica invertida)';}
  else if(quizTipo==='independencia'){parteInfo='📌 SIM vale +1 ponto, NÃO vale -1 ponto';}
  else{parteInfo='📌 SIM vale +1 ponto, NÃO vale -1 ponto, N/A não altera a pontuação';}
  const el=document.getElementById('quiz-parte');el.textContent=parteInfo;
  if(quizTipo==='ciclo'&&q.parte===2){
    el.style.background='linear-gradient(135deg,#FAEEDA,#FAC77533)';el.style.color='#854F0B';el.style.borderLeft='3px solid var(--amber)';
  }else{el.style.background='var(--surface2)';el.style.color='var(--text-muted)';el.style.borderLeft='none';}
  const btns=document.getElementById('quiz-btns');
  if(q.opcoes){
    btns.innerHTML=`<button class="quiz-btn sim" onclick="responder('sim')">✅ Sim</button><button class="quiz-btn nao" onclick="responder('nao')">❌ Não</button><button class="quiz-btn na" onclick="responder('na')">➖ Não se aplica</button>`;
  }else{
    btns.innerHTML=`<button class="quiz-btn sim" onclick="responder('sim')">✅ Sim</button><button class="quiz-btn nao" onclick="responder('nao')">❌ Não</button>`;
  }
  if(quizIdx>0)btns.innerHTML+=`<button class="quiz-btn" onclick="voltarQ()" style="margin-top:4px;font-size:12px;padding:10px">← Voltar</button>`;
}

window.responder=async function(resp){
  quizRespostas[quizIdx]=resp;
  if(quizIdx<quizPergs.length-1){
    const curParte=quizPergs[quizIdx].parte;quizIdx++;const nextParte=quizPergs[quizIdx].parte;
    if(curParte===1&&nextParte===2){
      const textos={
        ciclo:{titulo:'Atenção — A regra mudou!',desc:'Você completou a <strong>Parte 1</strong>.<br>Na <strong>Parte 2</strong> a lógica é invertida:'},
        independencia:{titulo:'Parte 2 — Atenção!',desc:'Você completou a <strong>Parte 1</strong>.<br>Na <strong>Parte 2</strong> a pontuação é invertida:'},
        casal:{titulo:'Metade concluída — Atenção!',desc:'Você completou a <strong>Parte 1</strong>.<br>Na <strong>Parte 2</strong> a lógica de pontos muda:'},
      };
      const t=textos[quizTipo]||textos.ciclo;
      document.getElementById('transicao-titulo').textContent=t.titulo;
      document.getElementById('transicao-desc').innerHTML=t.desc;
      ir('screen-transicao');
    }
    else{renderQuizQ();}
  }else await finalizarQuiz();
};
window.voltarQ=function(){if(quizIdx>0){quizIdx--;renderQuizQ();}};
window.continuarParte2=function(){renderQuizQ();ir('screen-quiz');};

async function renderResultado(tipo,pontos,resultado){
  const cores={'Ciclo de Expansão':'expansao','Relação Saudável':'expansao','Referência':'expansao','Acima da Média':'expansao','Ciclo de Equilíbrio':'equilibrio','Em Construção':'equilibrio','Caminho Comum':'equilibrio','Ciclo de Atenção':'atencao','Diálogo Iniciante':'atencao','Ponto de Partida':'atencao'};
  const icons={'Ciclo de Expansão':'🟢','Ciclo de Equilíbrio':'🟡','Ciclo de Atenção':'🔴','Referência':'⭐','Acima da Média':'🟢','Caminho Comum':'🟡','Ponto de Partida':'🔴','Relação Saudável':'🟢','Em Construção':'🟡','Diálogo Iniciante':'🔴'};
  const descs={'Ciclo de Expansão':'Você está construindo sua vida com clareza e consistência. Continue evoluindo — os resultados aparecem para quem mantém o foco.','Ciclo de Equilíbrio':'Você está estável, mas ainda há espaço para crescer. O risco aqui é a acomodação — pequenas ações consistentes podem mudar seu patamar.','Ciclo de Atenção':'Alguns aspectos da sua vida pedem uma revisão urgente. Reorganizar suas prioridades agora pode evitar perdas maiores no futuro.','Referência':'Você está no caminho certo e provavelmente já percebeu que pensa diferente das pessoas ao seu redor. Continue — os resultados vêm para quem age com consistência.','Acima da Média':'Você está mais preparado do que a maioria. Ainda existem lacunas que podem gerar imprevistos — vale reforçar os pontos mais fracos.','Caminho Comum':'Você segue o padrão da maioria das pessoas. É um começo, mas provavelmente insuficiente para garantir tranquilidade no futuro. Há espaço importante para evoluir.','Ponto de Partida':'Sua independência financeira ainda está distante da sua realidade atual. O primeiro passo é reconhecer isso — e começar a agir com pequenas mudanças consistentes.','Relação Saudável':'Vocês mantêm uma relação financeira madura e aberta. Continuem evoluindo — sempre há algo a melhorar.','Em Construção':'Vocês têm abertura para falar sobre finanças, mas alguns pontos críticos ainda ficam de fora. Revejam juntos onde perderam pontos.','Diálogo Iniciante':'O tema dinheiro ainda é pouco explorado entre vocês. Pequenas conversas regulares podem transformar completamente a relação financeira do casal.'};
  document.getElementById('resultado-card').innerHTML=`<div class="resultado-ciclo ${cores[resultado]||'equilibrio'}"><div class="resultado-icon">${icons[resultado]||'📊'}</div><div class="resultado-titulo">${esc(resultado)}</div><div class="resultado-pontos">${pontos>0?'+':''}${pontos} pontos</div><div class="resultado-desc">${esc(descs[resultado]||'')} </div></div>`;
  let todosHTML='<div class="section-title">Todos os níveis</div>';
  if(tipo==='ciclo'){
    todosHTML+=[{r:'Ciclo de Expansão',range:'de +11 a +30',c:'expansao'},{r:'Ciclo de Equilíbrio',range:'de -10 a +10',c:'equilibrio'},{r:'Ciclo de Atenção',range:'de -30 a -11',c:'atencao'}].map(n=>`<div class="resultado-ciclo ${n.c}" style="padding:12px 16px;margin-bottom:8px;text-align:left"><div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-weight:800;font-size:14px">${icons[n.r]} ${n.r}</div><div style="font-size:12px;margin-top:2px">${descs[n.r]}</div></div><div style="font-size:11px;font-weight:700;white-space:nowrap;margin-left:8px">${n.range}</div></div></div>`).join('');
  }else if(tipo==='independencia'){
    todosHTML+=[{r:'Referência',range:'14-15 pts',c:'expansao'},{r:'Acima da Média',range:'11-13 pts',c:'expansao'},{r:'Caminho Comum',range:'6-10 pts',c:'equilibrio'},{r:'Ponto de Partida',range:'até 5 pts',c:'atencao'}].map(n=>`<div class="resultado-ciclo ${n.c}" style="padding:12px 16px;margin-bottom:8px;text-align:left"><div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-weight:800;font-size:14px">${icons[n.r]} ${n.r}</div><div style="font-size:12px;margin-top:2px">${descs[n.r]}</div></div><div style="font-size:11px;font-weight:700;white-space:nowrap;margin-left:8px">${n.range}</div></div></div>`).join('');
  }else{
    todosHTML+=[{r:'Relação Saudável',range:'8+ pts',c:'expansao'},{r:'Em Construção',range:'-7 a +7 pts',c:'equilibrio'},{r:'Diálogo Iniciante',range:'-20 a -8 pts',c:'atencao'}].map(n=>`<div class="resultado-ciclo ${n.c}" style="padding:12px 16px;margin-bottom:8px;text-align:left"><div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-weight:800;font-size:14px">${icons[n.r]} ${n.r}</div><div style="font-size:12px;margin-top:2px">${descs[n.r]}</div></div><div style="font-size:11px;font-weight:700;white-space:nowrap;margin-left:8px">${n.range}</div></div></div>`).join('');
  }
  document.getElementById('resultado-ciclos').innerHTML=todosHTML;
  const diags=await getDiags(store.sessao.email);const hist=diags.filter(d=>d.tipo===tipo).slice(0,5);
  if(hist.length>1){
    document.getElementById('resultado-historico').innerHTML=`<div class="section-title" style="margin-top:1rem">Histórico</div>${hist.map(h=>`<div class="pront-item" style="margin-bottom:6px"><div><div style="font-size:13px;font-weight:600">${esc(h.resultado)}</div><div style="font-size:11px;color:var(--text-muted)">${new Date(h.criadoEm).toLocaleDateString('pt-BR')} · ${h.pontos>0?'+':''}${h.pontos} pts</div></div><span class="badge ${(h.resultado?.includes('Expansão')||h.resultado?.includes('Referência')||h.resultado?.includes('Saudável')||h.resultado?.includes('Acima'))?'badge-green':(h.resultado?.includes('Equilíbrio')||h.resultado?.includes('Construção')||h.resultado?.includes('Comum'))?'badge-amber':'badge-red'}">${h.pontos>0?'+':''}${h.pontos}</span></div>`).join('')}`;
  }else{document.getElementById('resultado-historico').innerHTML='';}
}

export { getDiags, DIAGS_CONFIG, renderDiagnosticos };
