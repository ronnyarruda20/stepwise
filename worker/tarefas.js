/* Banco de tarefas da prova de nivelamento. Cada tarefa tem o que a IA fala (`texto`) e o critério que o juiz
   usa para decidir se a resposta sustenta o nível (`criterio`). Os critérios são paráfrases nossas dos
   descritores do CEFR para produção oral — não são o texto oficial do Conselho da Europa.
   Desenho e regras: docs/01-prova-de-nivelamento.md. */

export const AQUECIMENTO = {
  id: "aquecimento",
  nivel: null,
  tipo: "fala",
  texto: "Hi! I'm your English partner. This is a short speaking test, about ten minutes. There are no wrong answers, just talk the best you can. Let's start easy: what's your name, and where are you from?",
};

const CRITERIO = {
  A1: "Gives at least one understandable, relevant answer using basic words or a simple sentence (e.g. 'I am a nurse', 'I work in a hospital'). Many errors are fine if the meaning is clear.",
  A2: "Answers with two or more connected simple sentences (and, but, then, because) about familiar topics. Basic tenses are mostly recognisable; meaning is clear despite errors.",
  B1: "Keeps talking for several sentences with a clear sequence or reasons, gives some detail and a simple opinion or explanation. Past/future forms mostly correct; errors do not block understanding.",
  B2: "Develops an argument or explanation with supporting points, shows both sides or nuance, uses linking words (however, on the other hand, although) and a good range of vocabulary. Speaks with some fluency; errors are occasional and do not cause misunderstanding.",
  C1: "Handles an abstract or hypothetical topic fluently, with complex structures (conditionals, relative clauses), precise and varied vocabulary and well-organised ideas. Errors are rare.",
};

export const TAREFAS = [
  { id: "a1-trabalho", nivel: "A1", texto: "What do you do? Do you work or study?" },
  { id: "a1-familia", nivel: "A1", texto: "Tell me about your family. Do you have brothers or sisters?" },
  { id: "a1-comida", nivel: "A1", texto: "What food do you like? What do you eat for breakfast?" },

  { id: "a2-rotina", nivel: "A2", texto: "Can you describe a normal day for you? What do you usually do in the morning and in the evening?" },
  { id: "a2-fim-de-semana", nivel: "A2", texto: "What did you do last weekend? Tell me a little about it." },
  { id: "a2-cidade", nivel: "A2", texto: "Tell me about the place where you live. What is it like, and what do you like about it?" },

  { id: "b1-viagem", nivel: "B1", texto: "Tell me about a trip or a special day you remember. What happened, and why do you remember it?" },
  { id: "b1-cidade-grande", nivel: "B1", texto: "Do you prefer living in a big city or in a small town? Why?" },
  { id: "b1-planos", nivel: "B1", texto: "What are your plans for next year? Is there something you would like to change in your life?" },

  { id: "b2-home-office", nivel: "B2", texto: "Some people say working from home is better than working in an office. What do you think? Try to give me arguments for both sides." },
  { id: "b2-tecnologia", nivel: "B2", texto: "How has technology changed the way families communicate? Do you think it is a good or a bad change?" },
  { id: "b2-educacao", nivel: "B2", texto: "If you could change one thing about the education system in Brazil, what would it be, and why?" },

  { id: "c1-sem-trabalho", nivel: "C1", texto: "Imagine that in twenty years nobody needs to work, because machines do everything. How would society change, and what problems might appear?" },
  { id: "c1-turismo", nivel: "C1", texto: "Some people argue that tourism ends up destroying the places travellers love. To what extent do you agree?" },
].map((t) => ({ ...t, tipo: "fala", criterio: CRITERIO[t.nivel] }));

/* Escuta: a IA fala um trecho e faz uma pergunta. Passa quem responde ao essencial (`esperado`), com as
   próprias palavras, mesmo com erro de gramática. */
export const ESCUTA = [
  {
    id: "escuta-a1",
    nivel: "A1",
    trecho: "My name is Laura. I am a teacher. I live in Florianópolis with my two cats.",
    pergunta: "What is Laura's job, and how many cats does she have?",
    esperado: "She is a teacher and she has two cats.",
  },
  {
    id: "escuta-a2",
    nivel: "A2",
    trecho: "Yesterday I wanted to go to the beach, but it started to rain, so I stayed at home and watched a movie with my brother.",
    pergunta: "Why didn't she go to the beach, and what did she do instead?",
    esperado: "Because it rained; she stayed home and watched a movie with her brother.",
  },
  {
    id: "escuta-b1",
    nivel: "B1",
    trecho: "I used to work in a bank, but I was always tired and stressed. Two years ago I decided to open a small bakery. I earn less money now, but I'm much happier.",
    pergunta: "Why did this person change jobs, and how is their life different now?",
    esperado: "They were tired and stressed at the bank; now they have a bakery, earn less but are happier.",
  },
  {
    id: "escuta-b2",
    nivel: "B2",
    trecho: "Although the company's profits went up last year, many employees feel their workload has become unsustainable. Management says hiring more staff would be too expensive, yet several experienced workers have already resigned.",
    pergunta: "What is the problem in this company, and what is contradictory about the management's position?",
    esperado: "Employees have too much work; management refuses to hire because of cost, but they are already losing experienced people (which also costs them).",
  },
  {
    id: "escuta-c1",
    nivel: "C1",
    trecho: "Critics of the new policy argue that, far from reducing traffic, building wider roads merely encourages more people to drive, so congestion returns within a few years. Economists call this induced demand.",
    pergunta: "In your own words, what is the critics' argument?",
    esperado: "Wider roads attract more drivers, so traffic comes back after some years (induced demand); building roads does not solve congestion.",
  },
].map((t) => ({
  ...t,
  tipo: "escuta",
  texto: "Now a listening question. Listen carefully. ... " + t.trecho + " ... " + t.pergunta,
  criterio: "Listening comprehension: the answer must contain the essential information — " + t.esperado + " Grammar errors do not matter; only whether the learner understood.",
}));

export const FECHAMENTO = "That's all. Thank you, you did great! Give me a moment while I check your answers.";

export const TEMAS = {
  "dia-a-dia": "everyday life: routine, home, family, food, weekend",
  viagem: "travel: airport, hotel, ordering food, asking for directions, sightseeing",
  trabalho: "work: describing your job, colleagues, a typical day, small talk at work",
  livre: "anything the learner wants to talk about",
};
