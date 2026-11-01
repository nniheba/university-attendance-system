export interface MotivationalPhrase {
  message: string;
  inspiration: string;
}

export const MOTIVATIONAL_PHRASES = [
  { message: "Construye hoy algo que mañana te haga sentir orgulloso.", inspiration: "Steve Jobs" },
  { message: "La curiosidad convierte una idea pequeña en un gran comienzo.", inspiration: "Steve Jobs" },
  { message: "El trabajo con propósito deja una huella que permanece.", inspiration: "Steve Jobs" },
  { message: "Elegir bien tu enfoque vale tanto como trabajar intensamente.", inspiration: "Steve Jobs" },
  { message: "Atrévete a simplificar hasta encontrar lo verdaderamente importante.", inspiration: "Steve Jobs" },
  { message: "Una visión clara transforma el esfuerzo en progreso.", inspiration: "Steve Jobs" },
  { message: "Aprende, crea y vuelve a intentarlo con una mirada nueva.", inspiration: "Steve Jobs" },
  { message: "Cada reto resuelto amplía lo que creías posible.", inspiration: "Bill Gates" },
  { message: "Escuchar una crítica útil puede acelerar tu crecimiento.", inspiration: "Bill Gates" },
  { message: "El conocimiento compartido multiplica las oportunidades.", inspiration: "Bill Gates" },
  { message: "La preparación convierte los cambios en posibilidades.", inspiration: "Bill Gates" },
  { message: "Aprender con constancia es una inversión que siempre acompaña.", inspiration: "Bill Gates" },
  { message: "Un problema difícil también puede ser una puerta a innovar.", inspiration: "Bill Gates" },
  { message: "Mide tu avance, comprende tus errores y sigue mejorando.", inspiration: "Bill Gates" },
  { message: "Observar con atención es el primer paso para comprender.", inspiration: "Leonardo da Vinci" },
  { message: "La creatividad crece cuando conectas saberes distintos.", inspiration: "Leonardo da Vinci" },
  { message: "Cada pregunta bien formulada abre un camino de descubrimiento.", inspiration: "Leonardo da Vinci" },
  { message: "Practicar una habilidad revela detalles que antes eran invisibles.", inspiration: "Leonardo da Vinci" },
  { message: "La imaginación avanza cuando la disciplina le da forma.", inspiration: "Leonardo da Vinci" },
  { message: "Estudia la realidad y después atrévete a transformarla.", inspiration: "Leonardo da Vinci" },
  { message: "La paciencia permite que una buena idea alcance profundidad.", inspiration: "Leonardo da Vinci" },
  { message: "Perfecciona cada paso hasta que el esfuerzo parezca natural.", inspiration: "Michael Jackson" },
  { message: "Tu forma de expresarte también puede inspirar a los demás.", inspiration: "Michael Jackson" },
  { message: "La excelencia nace de repetir con intención, no por rutina.", inspiration: "Michael Jackson" },
  { message: "Cuida los detalles: allí suele vivir lo memorable.", inspiration: "Michael Jackson" },
  { message: "Convierte la emoción en energía para crear algo auténtico.", inspiration: "Michael Jackson" },
  { message: "Ensaya con humildad y presenta tu mejor versión con confianza.", inspiration: "Michael Jackson" },
  { message: "El talento florece cuando encuentra disciplina y sensibilidad.", inspiration: "Michael Jackson" },
  { message: "Entrena tu mente para avanzar incluso cuando cuesta.", inspiration: "Muhammad Ali" },
  { message: "La confianza se fortalece cumpliendo pequeñas promesas diarias.", inspiration: "Muhammad Ali" },
  { message: "Una meta ambiciosa se conquista paso a paso.", inspiration: "Muhammad Ali" },
  { message: "La preparación silenciosa sostiene los grandes momentos.", inspiration: "Muhammad Ali" },
  { message: "No temas al esfuerzo: úsalo para descubrir tu capacidad.", inspiration: "Muhammad Ali" },
  { message: "Levántate con más experiencia cada vez que algo no salga bien.", inspiration: "Muhammad Ali" },
  { message: "Compite con tu versión de ayer y celebra cada avance.", inspiration: "Muhammad Ali" },
  { message: "Tus acciones cotidianas pueden mejorar el entorno que compartes.", inspiration: "Mahatma Gandhi" },
  { message: "La firmeza y la serenidad pueden caminar juntas.", inspiration: "Mahatma Gandhi" },
  { message: "El cambio duradero empieza con decisiones coherentes.", inspiration: "Mahatma Gandhi" },
  { message: "Aprender también es prepararse para servir mejor a otros.", inspiration: "Mahatma Gandhi" },
  { message: "La paciencia activa convierte una convicción en resultados.", inspiration: "Mahatma Gandhi" },
  { message: "Avanza con respeto sin renunciar a aquello que consideras justo.", inspiration: "Mahatma Gandhi" },
  { message: "Un propósito claro da dirección incluso a los pasos pequeños.", inspiration: "Mahatma Gandhi" },
  { message: "Comprender algo nuevo comienza aceptando lo que aún ignoras.", inspiration: "Marie Curie" },
  { message: "La investigación paciente ilumina preguntas que parecían imposibles.", inspiration: "Marie Curie" },
  { message: "El rigor convierte la curiosidad en conocimiento confiable.", inspiration: "Marie Curie" },
  { message: "Tu capacidad crece cuando estudias aquello que te desafía.", inspiration: "Marie Curie" },
  { message: "La evidencia y la perseverancia hacen avanzar las ideas.", inspiration: "Marie Curie" },
  { message: "Explorar con valentía puede abrir caminos para muchas personas.", inspiration: "Marie Curie" },
  { message: "Deja que cada descubrimiento despierte una pregunta mejor.", inspiration: "Marie Curie" },
  { message: "Tu voz gana fuerza cuando nace del aprendizaje y la empatía.", inspiration: "Maya Angelou" },
  { message: "La forma en que ayudas a otros también define tu éxito.", inspiration: "Maya Angelou" },
  { message: "Haz espacio para crecer sin olvidar cuánto has avanzado.", inspiration: "Maya Angelou" },
  { message: "La confianza se practica cada vez que eliges participar.", inspiration: "Maya Angelou" },
  { message: "Una actitud generosa puede convertir una clase en comunidad.", inspiration: "Maya Angelou" },
  { message: "Cuenta tu historia con honestidad y sigue escribiendo el próximo capítulo.", inspiration: "Maya Angelou" },
  { message: "El aprendizaje cobra sentido cuando también transforma tu mirada.", inspiration: "Maya Angelou" },
] as const satisfies readonly MotivationalPhrase[];

export function motivationalPhraseFor(seed: string): MotivationalPhrase {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16_777_619);
  }
  return MOTIVATIONAL_PHRASES[(hash >>> 0) % MOTIVATIONAL_PHRASES.length];
}
