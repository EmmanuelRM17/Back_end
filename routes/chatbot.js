const express = require("express");
const router = express.Router();
const db = require("../db");
const logger = require("../utils/logger");

/**
 * Función para ejecutar consultas a la base de datos como Promesas
 * Facilita el trabajo con async/await en las consultas
 */
const executeQuery = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) {
        logger.error(`Error en consulta SQL: ${err.message}, Query: ${query.substring(0, 100)}...`);
        reject(err);
        return;
      }
      
      // Verificar si los resultados están vacíos y devolver un array vacío en lugar de undefined
      resolve(results || []);
    });
  });
};

/**
 * Endpoint principal para procesar mensajes del chatbot
 * Detecta intenciones y devuelve respuestas dinámicas basadas en el contexto
 */
router.post("/mensaje", async (req, res) => {
  try {
    const { mensaje, contexto } = req.body;
    
    // Validación básica
    if (!mensaje || mensaje.trim() === "") {
      return res.status(400).json({ 
        error: "El mensaje no puede estar vacío",
        status: "error"
      });
    }
    
    // Procesamos el mensaje y obtenemos respuesta
    const respuesta = await procesarMensaje(mensaje, contexto);
    logger.info(`Mensaje procesado: "${mensaje.substring(0, 50)}..." - Tipo: ${respuesta.tipo}`);
    
    return res.json(respuesta);
    
  } catch (error) {
    logger.error(`Error en /chatbot/mensaje: ${error.message}`);
    return res.status(500).json({ 
      error: "Error al procesar el mensaje",
      mensaje: "Lo siento, tuve un problema al procesar tu consulta. ¿Podrías intentarlo de nuevo?",
      status: "error" 
    });
  }
});

/**
 * Procesa el mensaje del usuario y genera una respuesta apropiada
 * @param {string} mensaje - Texto del mensaje del usuario
 * @param {object} contexto - Contexto opcional de la conversación
 * @returns {object} - Respuesta estructurada para el usuario
 */
async function procesarMensaje(mensaje, contexto = {}) {
  try {
    // Normalizar el mensaje (minúsculas, quitar caracteres especiales, etc.)
    const mensajeNormalizado = normalizarTexto(mensaje);
    
    // 1. Extraer entidades/servicios específicos del mensaje
    const entidades = extraerEntidades(mensajeNormalizado);
    
    // 2. Buscar intenciones que coincidan con el mensaje
    const intencion = await buscarIntencion(mensajeNormalizado);
    
    // Si no encontramos ninguna intención, devolvemos respuesta por defecto
    if (!intencion) {
      // Intento de respuesta basada en entidades encontradas
      if (entidades.tratamientos.length > 0) {
        const tratamiento = entidades.tratamientos[0];
        const datoTratamiento = await consultarTratamiento(tratamiento);
        
        if (datoTratamiento && !datoTratamiento.error) {
          return {
            respuesta: `No estoy seguro exactamente qué quieres saber sobre ${tratamiento}, pero puedo decirte que es uno de los servicios que ofrecemos. ¿Necesitas información específica sobre este tratamiento?`,
            tipo: "Tratamientos",
            subtipo: "tratamiento_fallback",
            datos: datoTratamiento,
            entidades
          };
        }
      }
      
      // Si es una consulta general sobre tratamientos sin entidades específicas
      if (mensajeNormalizado.includes("servicio") || mensajeNormalizado.includes("tratamiento")) {
        const datosTratamientos = await consultarTratamientos();
        
        if (datosTratamientos && !datosTratamientos.error) {
          return {
            respuesta: `Ofrecemos los siguientes tratamientos dentales: ${datosTratamientos.servicios}. ¿Deseas información sobre alguno en particular?`,
            tipo: "Tratamientos",
            subtipo: "listado_general",
            datos: datosTratamientos,
            entidades
          };
        }
      }
      
      return {
        respuesta: "Lo siento, no entendí tu consulta. ¿Podrías ser más específico o preguntar de otra manera? Puedo ayudarte con información sobre nuestros tratamientos, horarios, citas o formas de contacto.",
        tipo: "default",
        datos: null,
        entidades
      };
    }
    
    // 3. Generar respuesta según la intención, considerando las entidades encontradas
    return await generarRespuesta(intencion, mensajeNormalizado, entidades, contexto);
    
  } catch (error) {
    logger.error(`Error al procesar mensaje: ${error.stack}`);
    throw error;
  }
}

/**
 * Normaliza el texto del mensaje para facilitar el procesamiento
 * @param {string} texto - Texto a normalizar
 * @returns {string} - Texto normalizado
 */
function normalizarTexto(texto) {
  if (!texto) return "";
  
  return texto.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Eliminar acentos
    .replace(/[^\w\s]/gi, " ")       // Reemplazar caracteres especiales por espacios
    .replace(/\s+/g, " ")            // Eliminar espacios múltiples
    .trim();
}

/**
 * Extrae entidades relevantes del mensaje del usuario
 * (tratamientos, horarios, etc.)
 * @param {string} mensaje - Mensaje normalizado
 * @returns {object} - Objeto con las entidades encontradas
 */
function extraerEntidades(mensaje) {
  const entidades = {
    tratamientos: [],
    horarios: false,
    ubicacion: false,
    contacto: false,
    citas: false,
    educativo: false,
    postTratamiento: false
  };
  
  // Palabras clave para detectar intención sobre horarios
  const palabrasHorario = ['horario', 'hora', 'abierto', 'disponible', 'atienden', 'cuando', 'cuándo', 'dias', 'días'];
  entidades.horarios = palabrasHorario.some(palabra => mensaje.includes(palabra));
  
  // Palabras clave para detectar intención sobre ubicación
  const palabrasUbicacion = ['donde', 'dónde', 'ubicacion', 'ubicación', 'dirección', 'direccion', 'llegar', 'encuentran'];
  entidades.ubicacion = palabrasUbicacion.some(palabra => mensaje.includes(palabra));
  
  // Palabras clave para detectar intención sobre contacto
  const palabrasContacto = ['contacto', 'telefono', 'teléfono', 'llamar', 'email', 'correo', 'whatsapp', 'contactar'];
  entidades.contacto = palabrasContacto.some(palabra => mensaje.includes(palabra));
  
  // Palabras clave para detectar intención sobre citas
  const palabrasCitas = ['cita', 'agendar', 'programar', 'consulta', 'reservar', 'visita', 'acudir'];
  entidades.citas = palabrasCitas.some(palabra => mensaje.includes(palabra));
  
  // Palabras clave para detectar intención sobre información educativa
  const palabrasEducativo = ['consejo', 'consejos', 'recomendacion', 'alimentacion', 'prevencion', 'cuidado', 'mitos'];
  entidades.educativo = palabrasEducativo.some(palabra => mensaje.includes(palabra));
  
  // Palabras clave para detectar intención sobre post-tratamiento
  const palabrasPostTratamiento = ['despues', 'después', 'posterior', 'recuperacion', 'sangrado', 'hinchazón', 'dolor'];
  entidades.postTratamiento = palabrasPostTratamiento.some(palabra => mensaje.includes(palabra));
  
  // Buscar tratamientos dentales mencionados
  entidades.tratamientos = extraerTratamientos(mensaje);
  
  return entidades;
}

/**
 * Extrae nombres de tratamientos dentales del mensaje
 * @param {string} mensaje - Mensaje del usuario normalizado
 * @returns {array} - Array con los tratamientos encontrados
 */
function extraerTratamientos(mensaje) {
  // Definición de tratamientos y sus sinónimos para una detección más robusta
  const catalogoTratamientos = [
    {nombre: "limpieza dental", alternativas: ["limpieza", "profilaxis", "higiene"]},
    {nombre: "extracción", alternativas: ["sacar", "quitar", "remover", "muela", "extraccion"]},
    {nombre: "consulta", alternativas: ["revision", "chequeo", "evaluacion", "diagnostico", "diagnóstico"]},
    {nombre: "empaste", alternativas: ["empastar", "tapar", "caries", "resina", "amalgama", "calza"]},
    {nombre: "brackets", alternativas: ["frenos", "alineadores", "alinear", "enderezar"]},
    {nombre: "prótesis", alternativas: ["protesis", "dentadura", "puente"]}
  ];
  
  const tratamientosEncontrados = [];
  
  // Buscar cada tratamiento y sus alternativas en el mensaje
  catalogoTratamientos.forEach(tratamiento => {
    if (mensaje.includes(tratamiento.nombre)) {
      tratamientosEncontrados.push(tratamiento.nombre);
    } else {
      for (const alternativa of tratamiento.alternativas) {
        if (mensaje.includes(alternativa)) {
          tratamientosEncontrados.push(tratamiento.nombre);
          break;
        }
      }
    }
  });
  
  return tratamientosEncontrados;
}

/**
 * Busca una intención que coincida con el mensaje del usuario
 * Implementa un algoritmo de coincidencia mejorado
 * @param {string} mensaje - Mensaje normalizado del usuario
 * @returns {object|null} - Intención encontrada o null
 */
async function buscarIntencion(mensaje) {
  try {
    // 1. Primero, intentar con coincidencias exactas de patrones completos
    const queryExacta = `
      SELECT * FROM chatbot 
      WHERE patron = ?
      ORDER BY prioridad DESC
      LIMIT 1
    `;
    
    const intencionesExactas = await executeQuery(queryExacta, [mensaje]);
    
    if (intencionesExactas.length > 0) {
      logger.debug(`Intención encontrada (coincidencia exacta): ${intencionesExactas[0].patron}`);
      return intencionesExactas[0];
    }
    
    // 2. Si no hay coincidencia exacta, buscar patrones que estén contenidos
    const queryContenido = `
      SELECT *, 
             (LENGTH(patron) / LENGTH(?)) as relevancia
      FROM chatbot 
      WHERE ? LIKE CONCAT('%', patron, '%') 
      ORDER BY prioridad DESC, relevancia DESC, LENGTH(patron) DESC
      LIMIT 1
    `;
    
    const intencionesContenido = await executeQuery(queryContenido, [mensaje, mensaje]);
    
    if (intencionesContenido.length > 0 && intencionesContenido[0].relevancia > 0.3) {
      logger.debug(`Intención encontrada (patrón contenido): ${intencionesContenido[0].patron}`);
      return intencionesContenido[0];
    }
    
    // 3. Buscar si el mensaje contiene algún patrón
    const queryInversa = `
      SELECT *,
             (LENGTH(patron) / LENGTH(?)) as relevancia
      FROM chatbot 
      WHERE CONCAT(' ', ?, ' ') LIKE CONCAT('% ', patron, ' %')
      ORDER BY prioridad DESC, LENGTH(patron) DESC
      LIMIT 1
    `;
    
    const intencionesInversas = await executeQuery(queryInversa, [mensaje, mensaje]);
    
    if (intencionesInversas.length > 0) {
      logger.debug(`Intención encontrada (mensaje contiene patrón): ${intencionesInversas[0].patron}`);
      return intencionesInversas[0];
    }
    
    // 4. Búsqueda por palabras clave individuales del patrón
    const queryPalabras = `
      SELECT c.*,
             COUNT(*) as coincidencias
      FROM chatbot c, 
           (SELECT DISTINCT palabra FROM (
             SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(?, ' ', n), ' ', -1) AS palabra
             FROM (
               SELECT 1 as n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5
               UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10
             ) numbers
             WHERE n <= 1 + LENGTH(?) - LENGTH(REPLACE(?, ' ', ''))
           ) palabras_mensaje
           WHERE LENGTH(palabra) > 3
          ) p
      WHERE CONCAT(' ', c.patron, ' ') LIKE CONCAT('% ', p.palabra, ' %')
      GROUP BY c.id
      ORDER BY coincidencias DESC, c.prioridad DESC
      LIMIT 1
    `;
    
    const intencionesPalabras = await executeQuery(queryPalabras, [mensaje, mensaje, mensaje]);
    
    if (intencionesPalabras.length > 0 && intencionesPalabras[0].coincidencias >= 2) {
      logger.debug(`Intención encontrada (coincidencia palabras): ${intencionesPalabras[0].patron}`);
      return intencionesPalabras[0];
    }
    
    // Si llegamos aquí, no se encontró ninguna intención que coincida
    logger.info(`No se encontró intención para el mensaje: "${mensaje.substring(0, 50)}..."`);
    return null;
    
  } catch (error) {
    logger.error(`Error al buscar intención: ${error.message}`);
    throw error;
  }
}

/**
 * Genera una respuesta basada en la intención detectada y las entidades
 * @param {object} intencion - Intención detectada
 * @param {string} mensaje - Mensaje original normalizado
 * @param {object} entidades - Entidades extraídas del mensaje
 * @param {object} contexto - Contexto de la conversación
 * @returns {object} - Respuesta estructurada
 */
async function generarRespuesta(intencion, mensaje, entidades, contexto = {}) {
  try {
    // 1. Verificar si la intención requiere una consulta a la base de datos
    let datosConsulta = null;
    
    // Si hay tratamientos específicos mencionados, priorizarlos en la consulta
    const hayTratamientoEspecifico = entidades.tratamientos.length > 0 && 
                                    intencion.categoria === 'Tratamientos';
    
    if (hayTratamientoEspecifico) {
      const tratamiento = entidades.tratamientos[0];
      datosConsulta = await consultarTratamiento(tratamiento);
      
      // Si no encontramos información específica, pero tenemos una intención general
      if (datosConsulta?.error && intencion.categoria === 'Tratamientos') {
        datosConsulta = await consultarTratamientos();
      }
    } 
    // Si no hay tratamientos específicos, pero hay una intención definida
    else if (intencion.tabla_consulta) {
      datosConsulta = await realizarConsultaSegunCategoria(intencion, mensaje, entidades);
    }
    
    // 2. Obtener una respuesta aleatoria de las disponibles
    const respuesta = seleccionarRespuestaAleatoria(intencion.respuestas);
    
    // 3. Si hay datos de consulta y la respuesta es una plantilla, reemplazar variables
    let respuestaFinal = respuesta;
    
    if (datosConsulta) {
      if (intencion.es_plantilla) {
        // Verificar si todas las variables de la plantilla tienen datos
        const variablesEnPlantilla = (respuesta.match(/\{\{([^}]+)\}\}/g) || [])
          .map(v => v.replace(/\{\{|\}\}/g, ''));
        
        // Si faltan datos esenciales, podemos buscar una respuesta alternativa
        const faltanDatosEsenciales = variablesEnPlantilla.some(v => 
          !datosConsulta[v] && !tieneValorPorDefecto(datosConsulta, v));
        
        if (faltanDatosEsenciales && datosConsulta.error) {
          // Si hay error en los datos, usar mensaje de error
          respuestaFinal = `Lo siento, ${datosConsulta.error}`;
          if (datosConsulta.sugerencias) {
            respuestaFinal += `. Estos son algunos tratamientos disponibles: ${datosConsulta.sugerencias}`;
          }
        } else {
          // Reemplazar variables con los datos disponibles
          respuestaFinal = reemplazarVariables(respuesta, datosConsulta);
        }
      } else if (datosConsulta.error) {
        // Si hay error pero no es plantilla, agregar información de error
        respuestaFinal += ` (Nota: ${datosConsulta.error})`;
      }
    }
    
    // 4. Devolver respuesta formateada
    return {
      respuesta: respuestaFinal,
      tipo: intencion.categoria,
      subtipo: hayTratamientoEspecifico ? 'tratamiento_especifico' : 'general',
      datos: datosConsulta,
      entidades: entidades
    };
    
  } catch (error) {
    logger.error(`Error al generar respuesta: ${error.stack}`);
    throw error;
  }
}

/**
 * Verifica si existe un valor por defecto para una variable
 * @param {object} datos - Datos disponibles
 * @param {string} variable - Nombre de la variable
 * @returns {boolean} - True si hay un valor o alternativa
 */
function tieneValorPorDefecto(datos, variable) {
  // Mapeo de variables a posibles alternativas
  const alternativas = {
    'servicio': ['title', 'nombre', 'nombre_servicio', 'tratamiento'],
    'duracion': ['duration', 'tiempo', 'minutos'],
    'horarios': ['horario', 'horas_atencion'],
    'redes': ['redes_sociales', 'redes_lista'],
    'direccion': ['calle_numero', 'ubicacion', 'domicilio'],
    'telefono': ['telefono_principal', 'contacto', 'celular']
  };
  
  // Verificar alternativas
  if (alternativas[variable]) {
    return alternativas[variable].some(alt => datos[alt] !== undefined);
  }
  
  return false;
}

/**
 * Realiza una consulta según la categoría de la intención
 * @param {object} intencion - Intención detectada
 * @param {string} mensaje - Mensaje normalizado
 * @param {object} entidades - Entidades detectadas
 * @returns {object} - Datos de la consulta
 */
async function realizarConsultaSegunCategoria(intencion, mensaje, entidades) {
  try {
    switch (intencion.categoria) {
      case 'Horario':
        return await consultarHorarios();
      
      case 'Contacto':
        return await consultarContacto();
      
      case 'Tratamientos':
        if (entidades.tratamientos.length > 0) {
          return await consultarTratamiento(entidades.tratamientos[0]);
        } else {
          return await consultarTratamientos();
        }
      
      case 'Citas':
        return await consultarInfoCitas();
      
      case 'Legal':
        return await consultarInfoLegal(intencion);
      
      case 'Educativo':
        return await consultarInfoEducativa(intencion);
      
      case 'Post-tratamiento':
        if (entidades.tratamientos.length > 0) {
          return await consultarInfoPostTratamiento(entidades.tratamientos[0]);
        } else {
          return await consultarInfoPostTratamientoGeneral();
        }
      
      default:
        // Consulta genérica para otras categorías
        if (intencion.campo_consulta && intencion.tabla_consulta) {
          return await consultaGenerica(
            intencion.tabla_consulta, 
            intencion.campo_consulta, 
            intencion.condicion
          );
        }
        return null;
    }
  } catch (error) {
    logger.error(`Error en consulta según categoría: ${error.message}`);
    return { error: "Ocurrió un error al obtener la información solicitada" };
  }
}

/**
 * Consulta información de contacto
 * @returns {object} - Datos de contacto
 */
async function consultarContacto() {
  try {
    const query = "SELECT * FROM inf_perfil_empresa LIMIT 1";
    const resultado = await executeQuery(query);
    
    if (resultado.length === 0) {
      return { error: "No se encontró información de contacto" };
    }
    
    // Obtener también redes sociales para complementar
    const redes = await consultarRedesSociales();
    
    return {
      ...resultado[0],
      redes: redes.redes || null,
      redes_lista: redes.redes_lista || []
    };
    
  } catch (error) {
    logger.error(`Error al consultar información de contacto: ${error.message}`);
    return { error: "No pudimos obtener la información de contacto" };
  }
}

/**
 * Selecciona una respuesta aleatoria de las disponibles
 * @param {string} respuestasStr - String con respuestas separadas
 * @returns {string} - Respuesta seleccionada
 */
function seleccionarRespuestaAleatoria(respuestasStr) {
  if (!respuestasStr) return "Lo siento, no tengo una respuesta para eso.";
  
  // Las respuestas están separadas por |||
  const respuestas = respuestasStr.split('|||').map(r => r.trim()).filter(r => r);
  
  if (respuestas.length === 0) {
    return "Lo siento, no tengo una respuesta para eso.";
  }
  
  // Seleccionar una aleatoriamente
  const indice = Math.floor(Math.random() * respuestas.length);
  return respuestas[indice];
}

/**
 * Consulta los horarios disponibles
 * @returns {object} - Datos de horarios
 */
async function consultarHorarios() {
  try {
    const query = `
      SELECT h.*, e.nombre as nombre_empleado 
      FROM horarios h
      LEFT JOIN empleados e ON h.empleado_id = e.id
      ORDER BY FIELD(h.dia_semana, 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'), h.hora_inicio
    `;
    
    const horarios = await executeQuery(query);
    
    if (horarios.length === 0) {
      return { 
        error: "No hay información de horarios disponible en la base de datos"
      };
    }
    
    // Procesar horarios para formato más amigable
    const horariosPorDia = {};
    const diasOrdenados = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    
    // Inicializar estructura
    diasOrdenados.forEach(dia => {
      horariosPorDia[dia] = [];
    });
    
    // Agrupar horarios por día
    horarios.forEach(h => {
      if (!horariosPorDia[h.dia_semana]) {
        horariosPorDia[h.dia_semana] = [];
      }
      
      // Formatear hora para mostrar (quitar segundos)
      const horaInicio = h.hora_inicio?.substring(0, 5) || '';
      const horaFin = h.hora_fin?.substring(0, 5) || '';
      
      horariosPorDia[h.dia_semana].push({
        empleado: h.nombre_empleado || 'General',
        horario: `${horaInicio} - ${horaFin}`,
        duracion: h.duracion || 0
      });
    });
    
    // Generar texto de horarios formateado
    const formatoHorario = formatearHorarios(horariosPorDia);
    
    return {
      horarios: formatoHorario,
      horarios_detalle: horariosPorDia,
      dias_atencion: diasOrdenados.filter(dia => horariosPorDia[dia]?.length > 0).join(', ')
    };
    
  } catch (error) {
    logger.error(`Error al consultar horarios: ${error.stack}`);
    return { 
      error: "Error al consultar la base de datos para obtener horarios"
    };
  }
}

/**
 * Formatea los horarios para mostrarlos de manera amigable
 * @param {object} horariosPorDia - Horarios agrupados por día
 * @returns {string} - Texto formateado
 */
function formatearHorarios(horariosPorDia) {
  let resultado = "";
  const diasOrdenados = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  
  for (const dia of diasOrdenados) {
    if (horariosPorDia[dia] && horariosPorDia[dia].length > 0) {
      resultado += `${dia}: `;
      
      // Agrupar horarios para mostrar horarios únicos
      const horarios = horariosPorDia[dia].map(h => h.horario);
      const horariosUnicos = [...new Set(horarios)].sort();
      
      resultado += horariosUnicos.join(", ");
      resultado += ". ";
    }
  }
  
  if (!resultado) {
    return "No hay información de horarios disponible en la base de datos.";
  }
  
  return resultado;
}

/**
 * Consulta información sobre las citas
 * @returns {object} - Datos sobre citas
 */
async function consultarInfoCitas() {
  try {
    // Consulta información general sobre citas (en una implementación real,
    // aquí podríamos consultar disponibilidad o políticas de citas)
    return {
      medios_agenda: "Puedes agendar citas a través de nuestra página web o directamente en la clínica.",
      requisitos: "Para tu primera consulta, te recomendamos llegar 15 minutos antes para llenar tu ficha médica.",
      politicas: "Para cancelaciones, te pedimos avisar con al menos 24 horas de anticipación.",
      informacion_adicional: "Para una mejor atención, te recomendamos describir brevemente el motivo de tu consulta al agendar la cita."
    };  
  } catch (error) {
    logger.error(`Error al consultar información de citas: ${error.message}`);
    return { error: "No pudimos obtener la información sobre citas" };
  }
}

/**
 * Consulta información sobre consejos educativos
 * @param {object} intencion - Intención detectada
 * @returns {object} - Información educativa dental
 */
async function consultarInfoEducativa(intencion) {
  try {
    // En una implementación real, esta información podría venir de la base de datos
    return {
      consejos_generales: "Cepillado 3 veces al día con pasta fluorada, uso de hilo dental a diario, y visitas regulares al dentista cada 6 meses.",
      alimentacion: "Limita alimentos azucarados, consume frutas y verduras crujientes, bebe agua en lugar de refrescos.",
      prevencion: "La prevención es clave para mantener una buena salud bucal. Incluye higiene diaria y chequeos regulares."
    };
  } catch (error) {
    logger.error(`Error al consultar información educativa: ${error.message}`);
    return { error: "No pudimos obtener la información educativa solicitada" };
  }
}

/**
 * Consulta información sobre post-tratamiento general
 * @returns {object} - Información post-tratamiento
 */
async function consultarInfoPostTratamientoGeneral() {
  try {
    // En una implementación real, esta información podría venir de la base de datos
    return {
      cuidados_generales: "Después de cualquier tratamiento dental, evita alimentos muy duros, calientes o fríos durante las primeras 24 horas.",
      signos_alarma: "Si experimentas dolor intenso, sangrado abundante o hinchazón que empeora, contacta a la clínica inmediatamente.",
      medicamentos: "Toma los medicamentos recetados según las indicaciones específicas del dentista."
    };
  } catch (error) {
    logger.error(`Error al consultar información post-tratamiento: ${error.message}`);
    return { error: "No pudimos obtener la información post-tratamiento solicitada" };
  }
}

/**
 * Consulta información post-tratamiento específica
 * @param {string} tratamiento - Tratamiento específico
 * @returns {object} - Información post-tratamiento específica
 */
async function consultarInfoPostTratamiento(tratamiento) {
  try {
    // Diferentes instrucciones según el tratamiento
    switch (tratamiento.toLowerCase()) {
      case 'limpieza dental':
        return {
          cuidados: "Es normal sentir sensibilidad. Evita alimentos muy fríos o calientes por 24 horas.",
          recomendaciones: "Continúa con tu rutina normal de cepillado y uso de hilo dental."
        };
      case 'extracción':
        return {
          cuidados: "Evita enjuagarte vigorosamente, escupir, usar popotes o fumar por 24 horas.",
          recomendaciones: "Aplica hielo en el exterior de la cara para reducir inflamación. Toma los medicamentos recetados según las indicaciones."
        };
      case 'empaste':
        return {
          cuidados: "Espera a que pase el efecto de la anestesia antes de comer para evitar morderte.",
          recomendaciones: "Si sientes que el empaste está alto al morder, contacta a la clínica para un ajuste."
        };
      default:
        return await consultarInfoPostTratamientoGeneral();
    }
  } catch (error) {
    logger.error(`Error al consultar información post-tratamiento específica: ${error.message}`);
    return { error: "No pudimos obtener la información post-tratamiento específica solicitada" };
  }
}

/**
 * Consulta información legal (términos, deslinde, etc.)
 * @param {object} intencion - Intención detectada
 * @returns {object} - Información legal
 */
async function consultarInfoLegal(intencion) {
  try {
    const tabla = intencion.tabla_consulta;
    
    // Validar el nombre de la tabla para evitar SQL injection
    const tablasPermitidas = ["inf_deslinde", "inf_terminos_condiciones", "inf_politicas_privacidad"];
    
    if (!tablasPermitidas.includes(tabla)) {
      return { 
        error: "Documento legal no disponible en la base de datos"
      };
    }
    
    // Consultar la versión más reciente del documento legal
    const query = `
      SELECT * FROM ${tabla}
      WHERE estado = 'activo'
      ORDER BY version DESC, fecha_actualizacion DESC
      LIMIT 1
    `;
    
    const resultados = await executeQuery(query);
    
    if (resultados.length === 0) {
      return { 
        error: `No se encontró información en la tabla ${tabla}`
      };
    }
    
    // Proporcionar un resumen si el contenido es demasiado largo
    const documento = resultados[0];
    
    // Asignar el campo contenido para compatibilidad con plantillas
    if (documento.titulo && !documento.contenido) {
      documento.contenido = documento.titulo;
    }
    
    if (documento.contenido && documento.contenido.length > 300) {
      documento.contenido_resumido = documento.contenido.substring(0, 297) + "...";
    } else {
      documento.contenido_resumido = documento.contenido;
    }
    
    return documento;
    
  } catch (error) {
    logger.error(`Error al consultar info legal: ${error.message}`);
    return { 
      error: "Error en la consulta a la base de datos para obtener información legal"
    };
  }
}

/**
 * Consulta redes sociales
 * @returns {object} - Datos de redes sociales
 */
async function consultarRedesSociales() {
  try {
    const query = "SELECT * FROM inf_redes_sociales WHERE activo = 1 ORDER BY nombre_red";
    const redes = await executeQuery(query);
    
    if (redes.length === 0) {
      return { 
        error: "No se encontraron redes sociales en la base de datos"
      };
    }
    
    // Formatear las redes para mostrarlas
    const redesFormateadas = redes.map(red => `${red.nombre_red}: ${red.url}`).join(", ");
    
    return { 
      redes: redesFormateadas,
      redes_lista: redes
    };
    
  } catch (error) {
    logger.error(`Error al consultar redes sociales: ${error.message}`);
    return { 
      error: "Error en la consulta a la base de datos para obtener redes sociales"
    };
  }
}

/**
 * Consulta tratamientos disponibles
 * @returns {object} - Catálogo de tratamientos
 */
async function consultarTratamientos() {
  try {
    const query = `
      SELECT id, title, description, category, price, duration, image_url
      FROM servicios
      WHERE activo = 1
      ORDER BY category, title
    `;
    
    const servicios = await executeQuery(query);
    
    if (servicios.length === 0) {
      return { 
        error: "No se encontraron tratamientos disponibles en la base de datos"
      };
    }
    
    // Agrupar servicios por categoría
    const serviciosPorCategoria = {};
    
    servicios.forEach(s => {
      if (!serviciosPorCategoria[s.category]) {
        serviciosPorCategoria[s.category] = [];
      }
      
      serviciosPorCategoria[s.category].push({
        id: s.id,
        nombre: s.title,
        duracion: s.duration,
        descripcion: s.description
      });
    });
    
    // Formatear para mostrar
    let listaServicios = "";
    
    for (const categoria in serviciosPorCategoria) {
      const serviciosTexto = serviciosPorCategoria[categoria]
        .map(s => s.nombre)
        .join(", ");
      
      listaServicios += `${categoria}: ${serviciosTexto}. `;
    }
    
    // Lista de todos los nombres de servicios (útil para sugerencias)
    const todosServicios = servicios.map(s => s.title);
    
    return { 
      servicios: listaServicios,
      serviciosPorCategoria: serviciosPorCategoria,
      lista_servicios: todosServicios,
      total_servicios: servicios.length
    };
    
  } catch (error) {
    logger.error(`Error al consultar tratamientos: ${error.message}`);
    return { 
      error: "Error en la consulta a la base de datos para obtener tratamientos"
    };
  }
}

/**
 * Consulta los detalles de un tratamiento específico
 * @param {string} nombreTratamiento - Nombre del tratamiento a consultar
 * @returns {object} - Datos del tratamiento
 */
async function consultarTratamiento(nombreTratamiento) {
  try {
    if (!nombreTratamiento) {
      return { error: "No se especificó ningún tratamiento" };
    }
    
    // Consulta principal para encontrar el tratamiento
    const query = `
      SELECT s.id, s.title, s.description, s.duration, s.category, s.image_url,
             s.tratamiento
      FROM servicios s
      WHERE s.title LIKE ? OR s.description LIKE ?
      ORDER BY CASE 
               WHEN s.title LIKE ? THEN 0 
               WHEN s.title LIKE ? THEN 1
               ELSE 2 
               END,
               LENGTH(s.title) ASC
      LIMIT 1
    `;
    
    // Varios patrones para mejorar la búsqueda
    const servicios = await executeQuery(
      query, 
      [
        nombreTratamiento, 
        `%${nombreTratamiento}%`,
        nombreTratamiento,
        `%${nombreTratamiento}%`
      ]
    );
    
    if (servicios.length === 0) {
      // Si no encuentra el tratamiento, obtener lista de tratamientos disponibles
      const todosTratamientos = await consultarTratamientos();
      
      let sugerencias = "No hay tratamientos similares disponibles.";
      
      if (!todosTratamientos.error && todosTratamientos.lista_servicios?.length > 0) {
        // Obtener hasta 5 tratamientos para sugerir
        sugerencias = todosTratamientos.lista_servicios.slice(0, 5).join(", ");
      }
      
      return { 
        error: `No se encontró el tratamiento "${nombreTratamiento}" en la base de datos`,
        sugerencias: sugerencias
      };
    }
    
    const servicio = servicios[0];
    
    // Consultar detalles adicionales
    const queryDetalles = `
      SELECT * FROM servicio_detalles
      WHERE servicio_id = ?
    `;
    
    const detalles = await executeQuery(queryDetalles, [servicio.id]);
    
    // Asignar campos para facilitar el uso con plantillas
    return {
      id: servicio.id,
      servicio: servicio.title,
      nombre: servicio.title,
      duracion: servicio.duration || "Consultar",
      categoria: servicio.category,
      descripcion: servicio.description,
      tratamiento: servicio.tratamiento || servicio.title,
      detalles: detalles,
      beneficios: obtenerDetallesPorTipo(detalles, 'beneficio'),
      incluye: obtenerDetallesPorTipo(detalles, 'incluye'),
      precauciones: obtenerDetallesPorTipo(detalles, 'precaucion')
    };
    
  } catch (error) {
    logger.error(`Error al consultar tratamiento: ${error.stack}`);
    return { 
      error: "Error en la consulta a la base de datos para obtener detalles del tratamiento"
    };
  }
}

/**
 * Filtra los detalles de un tratamiento por tipo
 * @param {Array} detalles - Lista de detalles
 * @param {string} tipo - Tipo de detalle a filtrar
 * @returns {string} - Lista formateada
 */
function obtenerDetallesPorTipo(detalles, tipo) {
  if (!detalles || !Array.isArray(detalles) || detalles.length === 0) {
    return "";
  }
  
  const filtrados = detalles
    .filter(d => d.tipo === tipo)
    .map(d => d.descripcion);
  
  if (filtrados.length === 0) {
    return "";
  }
  
  return filtrados.join(". ");
}

/**
 * Consulta genérica para cualquier tabla
 * @param {string} tabla - Nombre de la tabla
 * @param {string} campo - Campo a consultar
 * @param {string} condicion - Condición WHERE
 * @returns {object} - Resultados de la consulta
 */
async function consultaGenerica(tabla, campo, condicion) {
  try {
    // Lista de tablas permitidas para consulta
    const tablasPermitidas = [
      'chatbot', 'horarios', 'inf_deslinde', 
      'inf_perfil_empresa', 'inf_politicas_privacidad', 
      'inf_redes_sociales', 'inf_terminos_condiciones',
      'preguntas_frecuentes', 'servicios', 'servicio_detalles'
    ];
    
    // Validar el nombre de la tabla para evitar SQL injection
    if (!tablasPermitidas.includes(tabla)) {
      return { error: "Tabla no permitida" };
    }
    
    // Validar el campo para evitar SQL injection
    if (campo !== '*' && !/^[a-zA-Z0-9_,\s]+$/.test(campo)) {
      return { error: "Campo no válido" };
    }
    
    // Construir la consulta base
    let query = `SELECT ${campo} FROM ${tabla}`;
    
    // Agregar condición si existe
    if (condicion) {
      // Validación básica de condiciones
      if (!/^[a-zA-Z0-9_\s=<>'\(\)]+$/.test(condicion)) {
        return { error: "Condición no válida" };
      }
      
      query += ` WHERE ${condicion}`;
    }
    
    // Limitar resultados por seguridad
    query += " LIMIT 10";
    
    const resultados = await executeQuery(query);
    
    if (resultados.length === 0) {
      return { error: "No se encontraron resultados" };
    }
    
    return { resultados: resultados };
    
  } catch (error) {
    logger.error(`Error en consulta genérica: ${error.message}`);
    return { error: "Error al realizar la consulta" };
  }
}

/**
 * Reemplaza variables de plantilla con datos reales
 * @param {string} plantilla - Texto con variables {{variable}}
 * @param {object} datos - Datos para reemplazar variables
 * @returns {string} - Texto con variables reemplazadas
 */
function reemplazarVariables(plantilla, datos) {
  // Si no hay datos, devolver la plantilla original
  if (!datos || !plantilla) return plantilla || "";
  
  let resultado = plantilla;
  
  // Extraer todas las variables de la plantilla
  const variables = (plantilla.match(/\{\{([^}]+)\}\}/g) || [])
    .map(v => v.replace(/\{\{|\}\}/g, ''));
  
  // Reemplazar cada variable encontrada
  for (const variable of variables) {
    let valor = null;
    
    // Buscar el valor en los datos
    if (datos[variable] !== undefined) {
      valor = datos[variable];
    } 
    // Buscar en las alternativas si no se encuentra directamente
    else {
      const alternativas = obtieneAlternativasVariable(variable);
      
      for (const alt of alternativas) {
        if (datos[alt] !== undefined) {
          valor = datos[alt];
          break;
        }
      }
    }
    
    // Si se encontró un valor, reemplazar en la plantilla
    if (valor !== null) {
      const regex = new RegExp(`\\{\\{${variable}\\}\\}`, 'g');
      resultado = resultado.replace(regex, valor);
    }
  }
  
  // Verificar si quedaron variables sin reemplazar
  const variablesFaltantes = resultado.match(/\{\{([^}]+)\}\}/g);
  
  if (variablesFaltantes) {
    // Reemplazar variables restantes con valores predeterminados o eliminarlas
    for (const variable of variablesFaltantes) {
      const nombreVar = variable.replace(/\{\{|\}\}/g, '');
      const valorPredeterminado = obtenerValorPredeterminado(nombreVar, datos);
      
      const regex = new RegExp(`\\{\\{${nombreVar}\\}\\}`, 'g');
      resultado = resultado.replace(regex, valorPredeterminado);
    }
  }
  
  // Si hay un mensaje de error, agregarlo al final
  if (datos.error && !resultado.includes(datos.error)) {
    if (!resultado.endsWith('.') && !resultado.endsWith('?') && !resultado.endsWith('!')) {
      resultado += '.';
    }
    resultado += ` (${datos.error})`;
  }
  
  return resultado;
}

/**
 * Obtiene alternativas para una variable
 * @param {string} variable - Nombre de la variable
 * @returns {Array} - Lista de nombres alternativos
 */
function obtieneAlternativasVariable(variable) {
  // Mapeo de variables a posibles alternativas
  const alternativas = {
    'servicio': ['title', 'nombre', 'nombre_servicio', 'tratamiento'],
    'duracion': ['duration', 'tiempo', 'minutos'],
    'horarios': ['horario', 'horas_atencion'],
    'redes': ['redes_sociales', 'redes_lista'],
    'direccion': ['calle_numero', 'ubicacion', 'domicilio', 'direccion_completa'],
    'telefono': ['telefono_principal', 'contacto', 'celular'],
    'descripcion': ['description', 'contenido', 'detalle'],
    'categoria': ['category', 'tipo'],
    'contenido': ['descripcion', 'description', 'texto']
  };
  
  return alternativas[variable] || [];
}

/**
 * Obtiene un valor predeterminado para variables no encontradas
 * @param {string} variable - Nombre de la variable
 * @param {object} datos - Datos disponibles para contexto
 * @returns {string} - Valor predeterminado
 */
function obtenerValorPredeterminado(variable, datos) {
  switch (variable) {
    case 'servicio':
    case 'nombre':
    case 'title':
    case 'tratamiento':
      return "este tratamiento";
      
    case 'duracion':
    case 'duration':
      return "variable según paciente";
      
    case 'horarios':
      return "horario de atención regular";
      
    case 'descripcion':
    case 'description':
    case 'contenido':
      return "";
      
    default:
      return "";
  }
}

/**
 * Endpoint para obtener las preguntas frecuentes
 */
router.get("/preguntas-frecuentes", async (req, res) => {
  try {
    const query = `
      SELECT * FROM preguntas_frecuentes
      WHERE estado = 'registrado'
      ORDER BY fecha_creacion DESC
      LIMIT 15
    `;
    
    const preguntas = await executeQuery(query);
    
    // Si no hay preguntas frecuentes, proporcionar algunas por defecto
    if (preguntas.length === 0) {
      const preguntasPorDefecto = [
        { 
          id: 1, 
          pregunta: "¿Cuáles son sus horarios de atención?", 
          respuesta: "Nuestro horario es de lunes a viernes de 9:00 a 19:00 horas y sábados de 9:00 a 14:00 horas." 
        },
        { 
          id: 2, 
          pregunta: "¿Cómo puedo agendar una cita?", 
          respuesta: "Puedes agendar una cita a través de nuestra página web o directamente en la clínica." 
        },
        { 
          id: 3, 
          pregunta: "¿Qué debo llevar a mi primera consulta?", 
          respuesta: "Para tu primera consulta, te recomendamos llevar una identificación y, si tienes, información sobre tu historial médico." 
        },
        { 
          id: 4, 
          pregunta: "¿Cómo puedo cancelar una cita?", 
          respuesta: "Para cancelaciones, te pedimos avisar con al menos 24 horas de anticipación a través de nuestra página web o llamando a la clínica." 
        },
        { 
          id: 5, 
          pregunta: "¿Atienden urgencias dentales?", 
          respuesta: "Sí, contamos con atención de urgencias. Te recomendamos llamar previamente para confirmar la disponibilidad." 
        }
      ];
      
      return res.json({ 
        preguntas: preguntasPorDefecto,
        total: preguntasPorDefecto.length 
      });
    }
    
    return res.json({ 
      preguntas,
      total: preguntas.length 
    });
    
  } catch (error) {
    logger.error(`Error al obtener preguntas frecuentes: ${error.message}`);
    
    // Proporcionar preguntas por defecto en caso de error
    const preguntasPorDefecto = [
      { 
        id: 1, 
        pregunta: "¿Cuáles son sus horarios de atención?", 
        respuesta: "Nuestro horario es de lunes a viernes de 9:00 a 19:00 horas y sábados de 9:00 a 14:00 horas." 
      },
      { 
        id: 2, 
        pregunta: "¿Cómo puedo agendar una cita?", 
        respuesta: "Puedes agendar una cita a través de nuestra página web o directamente en la clínica." 
      },
      { 
        id: 3, 
        pregunta: "¿Qué debo llevar a mi primera consulta?", 
        respuesta: "Para tu primera consulta, te recomendamos llevar una identificación y, si tienes, información sobre tu historial médico." 
      }
    ];
    
    return res.json({ 
      preguntas: preguntasPorDefecto,
      total: preguntasPorDefecto.length,
      error: "Error al obtener preguntas frecuentes - mostrando valores predeterminados"
    });
  }
});

/**
 * Endpoint para obtener patrones del chatbot
 */
router.get("/patrones", async (req, res) => {
  try {
    // Filtrar por categoría si se especifica
    const { categoria } = req.query;
    
    let query = `
      SELECT id, patron, categoria, prioridad 
      FROM chatbot
    `;
    
    const params = [];
    
    if (categoria) {
      query += ` WHERE categoria = ?`;
      params.push(categoria);
    }
    
    query += ` ORDER BY categoria, prioridad DESC`;
    
    const patrones = await executeQuery(query, params);
    
    if (patrones.length === 0) {
      return res.json({ 
        error: "No se encontraron patrones en la base de datos",
        patrones: [],
        patrones_por_categoria: {},
        total: 0
      });
    }
    
    // Agrupar por categoría para facilitar el uso en el frontend
    const agrupados = {};
    
    patrones.forEach(p => {
      if (!agrupados[p.categoria]) {
        agrupados[p.categoria] = [];
      }
      agrupados[p.categoria].push(p);
    });
    
    return res.json({ 
      patrones,
      patrones_por_categoria: agrupados,
      total: patrones.length
    });
    
  } catch (error) {
    logger.error(`Error al obtener patrones: ${error.message}`);
    return res.status(500).json({ 
      error: "Error en la consulta a la base de datos para obtener patrones",
      patrones: [],
      patrones_por_categoria: {},
      total: 0
    });
  }
});

/**
 * Endpoint para obtener información de tratamientos
 */
router.get("/tratamientos", async (req, res) => {
  try {
    const { categoria } = req.query;
    let datos;
    
    if (categoria) {
      // Filtrar por categoría específica
      datos = await consultarTratamientosPorCategoria(categoria);
    } else {
      // Todos los tratamientos
      datos = await consultarTratamientos();
    }
    
    if (datos.error) {
      return res.status(404).json(datos);
    }
    
    return res.json(datos);
    
  } catch (error) {
    logger.error(`Error al obtener tratamientos: ${error.message}`);
    return res.status(500).json({ 
      error: "Error en la consulta a la base de datos para obtener tratamientos"
    });
  }
});

/**
 * Consulta tratamientos por categoría
 * @param {string} categoria - Categoría a consultar
 * @returns {object} - Datos de tratamientos
 */
async function consultarTratamientosPorCategoria(categoria) {
  try {
    const query = `
      SELECT id, title, description, category, duration, image_url
      FROM servicios
      WHERE category = ? AND activo = 1
      ORDER BY title
    `;
    
    const servicios = await executeQuery(query, [categoria]);
    
    if (servicios.length === 0) {
      return { 
        error: `No se encontraron tratamientos en la categoría ${categoria} en la base de datos`,
        servicios: [],
        categoria: categoria,
        total: 0
      };
    }
    
    return {
      servicios: servicios,
      categoria: categoria,
      total: servicios.length
    };
    
  } catch (error) {
    logger.error(`Error al consultar tratamientos por categoría: ${error.message}`);
    return {
      error: "Error en la consulta a la base de datos para obtener tratamientos por categoría",
      servicios: [],
      categoria: categoria,
      total: 0
    };
  }
}

/**
 * Endpoint para obtener detalles de un tratamiento
 */
router.get("/tratamiento", async (req, res) => {
  try {
    const { nombre } = req.query;
    
    if (!nombre) {
      return res.status(400).json({ error: "Debe especificar el nombre del tratamiento" });
    }
    
    const datos = await consultarTratamiento(nombre);
    
    if (datos.error) {
      return res.status(404).json(datos);
    }
    
    return res.json(datos);
    
  } catch (error) {
    logger.error(`Error al obtener tratamiento: ${error.message}`);
    return res.status(500).json({ 
      error: "Error en la consulta a la base de datos para obtener el detalle del tratamiento" 
    });
  }
});

/**
 * Endpoint para obtener horarios
 */
router.get("/horarios", async (req, res) => {
  try {
    const { dia } = req.query;
    
    if (dia) {
      // Consultar horario de un día específico
      const datos = await consultarHorarioPorDia(dia);
      
      if (datos.error) {
        return res.status(404).json(datos);
      }
      
      return res.json(datos);
    } else {
      // Consultar todos los horarios
      const datos = await consultarHorarios();
      
      if (datos.error) {
        return res.status(404).json(datos);
      }
      
      return res.json(datos);
    }
    
  } catch (error) {
    logger.error(`Error al obtener horarios: ${error.message}`);
    return res.status(500).json({ 
      error: "Error en la consulta a la base de datos para obtener horarios" 
    });
  }
});

/**
 * Consulta horarios de un día específico
 * @param {string} dia - Día de la semana
 * @returns {object} - Datos de horarios del día
 */
async function consultarHorarioPorDia(dia) {
  try {
    // Normalizar el día (primera letra mayúscula, resto minúsculas)
    const diaNormalizado = dia.charAt(0).toUpperCase() + dia.slice(1).toLowerCase();
    
    // Mapeo de posibles variaciones
    const mapDias = {
      'lun': 'Lunes',
      'mar': 'Martes',
      'mie': 'Miércoles',
      'jue': 'Jueves',
      'vie': 'Viernes',
      'sab': 'Sábado',
      'dom': 'Domingo'
    };
    
    // Obtener el día completo si es una abreviatura
    const diaConsulta = mapDias[diaNormalizado.substring(0, 3)] || diaNormalizado;
    
    // Validar que sea un día válido
    const diasValidos = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    
    if (!diasValidos.includes(diaConsulta)) {
      return { 
        error: "Día no válido. Debe ser uno de: " + diasValidos.join(", "),
        dia: diaNormalizado
      };
    }
    
    const query = `
      SELECT h.*, e.nombre as nombre_empleado 
      FROM horarios h
      LEFT JOIN empleados e ON h.empleado_id = e.id
      WHERE h.dia_semana = ?
      ORDER BY h.hora_inicio
    `;
    
    const horarios = await executeQuery(query, [diaConsulta]);
    
    if (horarios.length === 0) {
      return {
        error: `No se encontraron horarios para el día ${diaConsulta} en la base de datos`,
        dia: diaConsulta,
        horarios: []
      };
    }
    
    // Formatear horarios para este día
    const horariosFormateados = horarios.map(h => {
      const horaInicio = h.hora_inicio?.substring(0, 5) || '';
      const horaFin = h.hora_fin?.substring(0, 5) || '';
      
      return {
        horario: `${horaInicio} - ${horaFin}`,
        empleado: h.nombre_empleado || 'General',
        duracion: h.duracion || 0
      };
    });
    
    // Generar texto formateado
    const textoHorarios = horariosFormateados
      .map(h => h.horario)
      .filter((v, i, a) => a.indexOf(v) === i) // Eliminar duplicados
      .join(", ");
    
    return {
      dia: diaConsulta,
      horarios: horariosFormateados,
      texto_horarios: `${diaConsulta}: ${textoHorarios}`
    };
    
  } catch (error) {
    logger.error(`Error al consultar horario por día: ${error.message}`);
    return { 
      error: `Error en la consulta a la base de datos para obtener horarios del día ${dia}`,
      dia: dia
    };
  }
}

/**
 * Endpoint para obtener información de la empresa
 */
router.get("/perfil-empresa", async (req, res) => {
  try {
    const query = "SELECT * FROM inf_perfil_empresa LIMIT 1";
    const resultado = await executeQuery(query);
    
    if (resultado.length === 0) {
      return res.status(404).json({ 
        error: "No se encontró información del perfil de empresa en la base de datos"
      });
    }
    
    const empresa = resultado[0];
    
    // Formatear dirección completa
    if (empresa.calle_numero && empresa.localidad) {
      empresa.direccion_completa = `${empresa.calle_numero}, ${empresa.localidad}, ${empresa.municipio || ''}, ${empresa.estado || ''}${empresa.codigo_postal ? ', C.P. ' + empresa.codigo_postal : ''}`.replace(/,\s+,/g, ',').replace(/,\s+$/g, '');
    }
    
    return res.json(empresa);
    
  } catch (error) {
    logger.error(`Error al obtener perfil de empresa: ${error.message}`);
    return res.status(500).json({
      error: "Error en la consulta a la base de datos para obtener perfil de empresa"
    });
  }
});

/**
 * Endpoint para obtener redes sociales
 */
router.get("/redes-sociales", async (req, res) => {
  try {
    const datos = await consultarRedesSociales();
    
    if (datos.error) {
      return res.status(404).json(datos);
    }
    
    return res.json(datos);
    
  } catch (error) {
    logger.error(`Error al obtener redes sociales: ${error.message}`);
    return res.status(500).json({ 
      error: "Error en la consulta a la base de datos para obtener redes sociales" 
    });
  }
});

/**
 * Endpoint para obtener documentos legales
 */
router.get("/legal/:tipo", async (req, res) => {
  try {
    const { tipo } = req.params;
    
    // Mapear tipo a tabla
    let tabla;
    switch (tipo.toLowerCase()) {
      case 'deslinde':
        tabla = 'inf_deslinde';
        break;
      case 'terminos':
      case 'términos':
      case 'condiciones':
        tabla = 'inf_terminos_condiciones';
        break;
      case 'privacidad':
      case 'politicas':
      case 'políticas':
        tabla = 'inf_politicas_privacidad';
        break;
      default:
        return res.status(400).json({ 
          error: "Tipo no válido",
          tipos_permitidos: ["deslinde", "terminos", "privacidad"]
        });
    }
    
    const query = `
      SELECT * FROM ${tabla}
      WHERE estado = 'activo'
      ORDER BY version DESC, fecha_actualizacion DESC
      LIMIT 1
    `;
    
    const resultado = await executeQuery(query);
    
    if (resultado.length === 0) {
      return res.status(404).json({ 
        error: `No se encontró el documento legal de tipo '${tipo}' en la base de datos`
      });
    }
    
    return res.json(resultado[0]);
    
  } catch (error) {
    logger.error(`Error al obtener documento legal: ${error.message}`);
    return res.status(500).json({ 
      error: "Error en la consulta a la base de datos para obtener documentos legales"
    });
  }
});

module.exports = router;