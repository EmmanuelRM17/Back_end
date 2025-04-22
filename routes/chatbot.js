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
        logger.error(
          `Error en consulta SQL: ${err.message}, Query: ${query.substring(
            0,
            100
          )}...`
        );
        reject(err);
        return;
      }
      resolve(results);
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
        status: "error",
      });
    }

    // Procesamos el mensaje y obtenemos respuesta
    const respuesta = await procesarMensaje(mensaje, contexto);
    logger.info(
      `Mensaje procesado: "${mensaje.substring(0, 50)}..." - Tipo: ${
        respuesta.tipo
      }`
    );

    return res.json(respuesta);
  } catch (error) {
    logger.error(`Error en /chatbot/mensaje: ${error.message}`);
    return res.status(500).json({
      error: "Error al procesar el mensaje",
      mensaje:
        "Lo siento, tuve un problema al procesar tu consulta. ¿Podrías intentarlo de nuevo?",
      status: "error",
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
      // Normalizar el mensaje
      const mensajeNormalizado = normalizarTexto(mensaje);
      
      // CAMBIO CRUCIAL: Primero buscar si hay un servicio específico mencionado
      const servicios = await extraerServicios(mensajeNormalizado);
      
      if (servicios.length > 0) {
        // Si se menciona un servicio específico, priorizar esta consulta
        const datosServicio = await consultarPrecioServicio(servicios[0]);
        
        if (datosServicio && !datosServicio.error) {
          // Construir una respuesta detallada sobre el servicio
          const respuestaDetallada = construirRespuestaServicio(datosServicio);
          
          return {
            respuesta: respuestaDetallada,
            tipo: "Servicios",
            subtipo: "servicio_especifico",
            datos: datosServicio
          };
        }
      }
      
      // Si no hay servicio específico, continuar con el proceso normal
      // [Resto del código procesarMensaje actual]
    } catch (error) {
      logger.error(`Error al procesar mensaje: ${error.stack}`);
      throw error;
    }
  }
  
  // Función para construir respuesta detallada sobre un servicio
  function construirRespuestaServicio(datosServicio) {
    let respuesta = `**${datosServicio.servicio || datosServicio.nombre}**\n`;
    respuesta += `Precio: $${datosServicio.precio} MXN\n`;
    
    if (datosServicio.duracion) {
      respuesta += `Duración aproximada: ${datosServicio.duracion}\n`;
    }
    
    if (datosServicio.descripcion) {
      respuesta += `\n${datosServicio.descripcion}\n`;
    }
    
    if (datosServicio.beneficios) {
      respuesta += `\nBeneficios: ${datosServicio.beneficios}\n`;
    }
    
    if (datosServicio.incluye) {
      respuesta += `\nIncluye: ${datosServicio.incluye}\n`;
    }
    
    respuesta += "\n¿Deseas agendar una cita para este servicio o tienes alguna otra pregunta?";
    
    return respuesta;
  }

/**
 * Normaliza el texto del mensaje para facilitar el procesamiento
 * @param {string} texto - Texto a normalizar
 * @returns {string} - Texto normalizado
 */
function normalizarTexto(texto) {
  if (!texto) return "";

  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Eliminar acentos
    .replace(/[^\w\s]/gi, " ") // Reemplazar caracteres especiales por espacios
    .replace(/\s+/g, " ") // Eliminar espacios múltiples
    .trim();
}

/**
 * Extrae entidades relevantes del mensaje del usuario
 * (servicios, precios, horarios, etc.)
 * @param {string} mensaje - Mensaje normalizado
 * @returns {object} - Objeto con las entidades encontradas
 */
function extraerEntidades(mensaje) {
  const entidades = {
    servicios: [],
    precios: false,
    horarios: false,
    ubicacion: false,
    contacto: false,
  };

  // Palabras clave para detectar intención sobre precios
  const palabrasPrecio = [
    "precio",
    "costo",
    "valor",
    "cuanto",
    "cuánto",
    "cuesta",
    "cobran",
    "tarifa",
    "pagar",
  ];
  entidades.precios = palabrasPrecio.some((palabra) =>
    mensaje.includes(palabra)
  );

  // Palabras clave para detectar intención sobre horarios
  const palabrasHorario = [
    "horario",
    "hora",
    "abierto",
    "disponible",
    "atienden",
    "cuando",
    "cuándo",
    "dias",
    "días",
  ];
  entidades.horarios = palabrasHorario.some((palabra) =>
    mensaje.includes(palabra)
  );

  // Palabras clave para detectar intención sobre ubicación
  const palabrasUbicacion = [
    "donde",
    "dónde",
    "ubicacion",
    "ubicación",
    "dirección",
    "direccion",
    "llegar",
    "encuentran",
  ];
  entidades.ubicacion = palabrasUbicacion.some((palabra) =>
    mensaje.includes(palabra)
  );

  // Palabras clave para detectar intención sobre contacto
  const palabrasContacto = [
    "contacto",
    "telefono",
    "teléfono",
    "llamar",
    "email",
    "correo",
    "whatsapp",
    "contactar",
  ];
  entidades.contacto = palabrasContacto.some((palabra) =>
    mensaje.includes(palabra)
  );

  // Buscar servicios dentales mencionados
  entidades.servicios = extraerServicios(mensaje);

  return entidades;
}

/**
 * Extrae nombres de servicios dentales del mensaje
 * @param {string} mensaje - Mensaje del usuario normalizado
 * @returns {array} - Array con los servicios encontrados
 */
function extraerServicios(mensaje) {
    // Obtener lista completa de servicios desde la base de datos (si es posible cachear)
    return obtenerServiciosCache().then(serviciosDisponibles => {
      const serviciosEncontrados = [];
      
      // Primera pasada: buscar coincidencias exactas (con y sin acentos)
      for (const servicio of serviciosDisponibles) {
        // Normalizar nombre de servicio (sin acentos, minúsculas)
        const servicioNormalizado = servicio.toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        
        const mensajeNormalizado = mensaje.toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        
        // Verificar coincidencia exacta
        if (mensajeNormalizado.includes(servicioNormalizado)) {
          return [servicio]; // Retorna inmediatamente si hay coincidencia exacta
        }
      }
      
      // Si no hay coincidencias exactas, continuar con el método actual
      // [Resto del código de extraerServicios actual]
      
      return serviciosEncontrados;
    });
  }
  
  // Función para obtener y cachear servicios
  async function obtenerServiciosCache() {
    if (!global.serviciosCache || Date.now() - global.serviciosCacheTime > 3600000) {
      const query = "SELECT title FROM servicios";
      const servicios = await executeQuery(query);
      global.serviciosCache = servicios.map(s => s.title);
      global.serviciosCacheTime = Date.now();
    }
    return global.serviciosCache;
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
      logger.debug(
        `Intención encontrada (coincidencia exacta): ${intencionesExactas[0].patron}`
      );
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

    const intencionesContenido = await executeQuery(queryContenido, [
      mensaje,
      mensaje,
    ]);

    if (
      intencionesContenido.length > 0 &&
      intencionesContenido[0].relevancia > 0.3
    ) {
      logger.debug(
        `Intención encontrada (patrón contenido): ${intencionesContenido[0].patron}`
      );
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

    const intencionesInversas = await executeQuery(queryInversa, [
      mensaje,
      mensaje,
    ]);

    if (intencionesInversas.length > 0) {
      logger.debug(
        `Intención encontrada (mensaje contiene patrón): ${intencionesInversas[0].patron}`
      );
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

    const intencionesPalabras = await executeQuery(queryPalabras, [
      mensaje,
      mensaje,
      mensaje,
    ]);

    if (
      intencionesPalabras.length > 0 &&
      intencionesPalabras[0].coincidencias >= 2
    ) {
      logger.debug(
        `Intención encontrada (coincidencia palabras): ${intencionesPalabras[0].patron}`
      );
      return intencionesPalabras[0];
    }

    // Si llegamos aquí, no se encontró ninguna intención que coincida
    logger.info(
      `No se encontró intención para el mensaje: "${mensaje.substring(
        0,
        50
      )}..."`
    );
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

    // Si hay servicios específicos mencionados, priorizarlos en la consulta
    const hayServicioEspecifico =
      entidades.servicios.length > 0 &&
      (intencion.categoria === "Servicios" ||
        intencion.categoria === "Precios");

    if (hayServicioEspecifico) {
      const servicio = entidades.servicios[0];
      datosConsulta = await consultarPrecioServicio(servicio);

      // Si no encontramos información específica, pero tenemos una intención general
      if (datosConsulta?.error && intencion.categoria === "Servicios") {
        datosConsulta = await consultarServicios();
      }
    }
    // Si no hay servicios específicos, pero hay una intención definida
    else if (intencion.tabla_consulta) {
      datosConsulta = await realizarConsultaSegunCategoria(
        intencion,
        mensaje,
        entidades
      );
    }

    // 2. Obtener una respuesta aleatoria de las disponibles
    const respuesta = seleccionarRespuestaAleatoria(intencion.respuestas);

    // 3. Si hay datos de consulta y la respuesta es una plantilla, reemplazar variables
    let respuestaFinal = respuesta;

    if (datosConsulta) {
      if (intencion.es_plantilla) {
        // Verificar si todas las variables de la plantilla tienen datos
        const variablesEnPlantilla = (
          respuesta.match(/\{\{([^}]+)\}\}/g) || []
        ).map((v) => v.replace(/\{\{|\}\}/g, ""));

        // Si faltan datos esenciales, podemos buscar una respuesta alternativa
        const faltanDatosEsenciales = variablesEnPlantilla.some(
          (v) => !datosConsulta[v] && !tieneValorPorDefecto(datosConsulta, v)
        );

        if (faltanDatosEsenciales && datosConsulta.error) {
          // Si hay error en los datos, usar mensaje de error
          respuestaFinal = `Lo siento, ${datosConsulta.error}`;
          if (datosConsulta.sugerencias) {
            respuestaFinal += `. Estos son algunos servicios disponibles: ${datosConsulta.sugerencias}`;
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
      subtipo: hayServicioEspecifico ? "servicio_especifico" : "general",
      datos: datosConsulta,
      entidades: entidades,
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
    servicio: ["title", "nombre", "nombre_servicio"],
    precio: ["price", "precio_servicio", "costo"],
    duracion: ["duration", "tiempo", "minutos"],
    horarios: ["horario", "horas_atencion"],
    redes: ["redes_sociales", "redes_lista"],
    direccion: ["calle_numero", "ubicacion", "domicilio"],
    telefono: ["telefono_principal", "contacto", "celular"],
  };

  // Verificar alternativas
  if (alternativas[variable]) {
    return alternativas[variable].some((alt) => datos[alt] !== undefined);
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
      case "Horario":
        return await consultarHorarios();

      case "Redes":
        return await consultarRedesSociales();

      case "Empresa":
        return await consultarInfoEmpresa(intencion);

      case "Legal":
        return await consultarInfoLegal(intencion);

      case "Servicios":
        if (entidades.servicios.length > 0) {
          return await consultarPrecioServicio(entidades.servicios[0]);
        } else {
          return await consultarServicios();
        }

      case "Precios":
        // Extraer el nombre del servicio del mensaje
        if (entidades.servicios.length > 0) {
          return await consultarPrecioServicio(entidades.servicios[0]);
        } else {
          // Si no hay servicio específico pero preguntan por precios
          return {
            mensaje_generico:
              "Contamos con diferentes tratamientos con precios variados. ¿Sobre qué tratamiento específico te gustaría conocer el precio?",
          };
        }

      case "Contacto":
        return await consultarContacto();

      case "Ubicacion":
        return await consultarUbicacion();

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
 * Consulta información de ubicación
 * @returns {object} - Datos de ubicación
 */
async function consultarUbicacion() {
  try {
    const query = "SELECT * FROM inf_perfil_empresa LIMIT 1";
    const resultado = await executeQuery(query);

    if (resultado.length === 0) {
      return { error: "No se encontró información de ubicación" };
    }

    // Formatear dirección completa
    const empresa = resultado[0];
    const direccion = `${empresa.calle_numero}, ${empresa.localidad}, ${empresa.municipio}, ${empresa.estado}, C.P. ${empresa.codigo_postal}`;

    return {
      ...resultado[0],
      direccion_completa: direccion,
    };
  } catch (error) {
    logger.error(`Error al consultar ubicación: ${error.message}`);
    return { error: "No pudimos obtener la información de ubicación" };
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
  const respuestas = respuestasStr
    .split("|||")
    .map((r) => r.trim())
    .filter((r) => r);

  if (respuestas.length === 0) {
    return "Lo siento, no tengo una respuesta para eso.";
  }

  // Seleccionar una aleatoriamente
  const indice = Math.floor(Math.random() * respuestas.length);
  return respuestas[indice];
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
      redes_lista: redes.redes_lista || [],
    };
  } catch (error) {
    logger.error(
      `Error al consultar información de contacto: ${error.message}`
    );
    return { error: "No pudimos obtener la información de contacto" };
  }
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
      return { error: "No hay información de horarios disponible" };
    }

    // Procesar horarios para formato más amigable
    const horariosPorDia = {};
    const diasOrdenados = [
      "Lunes",
      "Martes",
      "Miércoles",
      "Jueves",
      "Viernes",
      "Sábado",
      "Domingo",
    ];

    // Inicializar estructura
    diasOrdenados.forEach((dia) => {
      horariosPorDia[dia] = [];
    });

    // Agrupar horarios por día
    horarios.forEach((h) => {
      if (!horariosPorDia[h.dia_semana]) {
        horariosPorDia[h.dia_semana] = [];
      }

      // Formatear hora para mostrar (quitar segundos)
      const horaInicio = h.hora_inicio?.substring(0, 5) || "";
      const horaFin = h.hora_fin?.substring(0, 5) || "";

      horariosPorDia[h.dia_semana].push({
        empleado: h.nombre_empleado || "General",
        horario: `${horaInicio} - ${horaFin}`,
        duracion: h.duracion || 0,
      });
    });

    // Generar texto de horarios formateado
    const formatoHorario = formatearHorarios(horariosPorDia);

    return {
      horarios: formatoHorario,
      horarios_detalle: horariosPorDia,
      dias_atencion: diasOrdenados
        .filter((dia) => horariosPorDia[dia]?.length > 0)
        .join(", "),
    };
  } catch (error) {
    logger.error(`Error al consultar horarios: ${error.stack}`);
    return { error: "No pudimos obtener los horarios en este momento" };
  }
}

/**
 * Formatea los horarios para mostrarlos de manera amigable
 * @param {object} horariosPorDia - Horarios agrupados por día
 * @returns {string} - Texto formateado
 */
function formatearHorarios(horariosPorDia) {
  let resultado = "";
  const diasOrdenados = [
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
    "Domingo",
  ];

  for (const dia of diasOrdenados) {
    if (horariosPorDia[dia] && horariosPorDia[dia].length > 0) {
      resultado += `${dia}: `;

      // Agrupar horarios para mostrar horarios únicos
      const horarios = horariosPorDia[dia].map((h) => h.horario);
      const horariosUnicos = [...new Set(horarios)].sort();

      resultado += horariosUnicos.join(", ");
      resultado += ". ";
    }
  }

  if (!resultado) {
    return "No hay horarios disponibles.";
  }

  return resultado;
}

/**
 * Consulta información sobre la empresa
 * @param {object} intencion - Intención detectada
 * @returns {object} - Datos de la empresa
 */
async function consultarInfoEmpresa(intencion) {
  try {
    // Consulta según el tipo específico
    let query;
    let params = [];

    if (intencion.condicion) {
      // Si hay una condición específica (ej: tipo = 'Historia')
      query = `
        SELECT * FROM acerca_de 
        WHERE ${intencion.condicion}
        ORDER BY fecha_actualizacion DESC, id DESC
        LIMIT 1
      `;
    } else {
      // Consulta general para información de la empresa
      query = `
        SELECT * FROM inf_perfil_empresa 
        ORDER BY id_empresa LIMIT 1
      `;
    }

    const resultados = await executeQuery(query, params);

    if (resultados.length === 0) {
      return {
        error: "No se encontró información disponible sobre la empresa",
      };
    }

    // Si es acerca_de, formateamos en base al tipo
    if (intencion.condicion && intencion.condicion.includes("tipo")) {
      const tipoInfo = resultados[0].tipo || "Información";
      return {
        tipo: tipoInfo,
        descripcion: resultados[0].descripcion,
        contenido: resultados[0].descripcion, // Para compatibilidad con plantillas
        fecha_actualizacion: resultados[0].fecha_actualizacion,
      };
    }

    return resultados[0];
  } catch (error) {
    logger.error(`Error al consultar info de empresa: ${error.message}`);
    return {
      error: "No pudimos obtener la información solicitada sobre la empresa",
    };
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
    const tablasPermitidas = [
      "inf_deslinde",
      "inf_terminos_condiciones",
      "inf_politicas_privacidad",
    ];

    if (!tablasPermitidas.includes(tabla)) {
      return { error: "Documento legal no disponible" };
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
      return { error: "No se encontró la información legal solicitada" };
    }

    // Proporcionar un resumen si el contenido es demasiado largo
    const documento = resultados[0];

    // Asignar el campo contenido para compatibilidad con plantillas
    if (documento.titulo && !documento.contenido) {
      documento.contenido = documento.titulo;
    }

    if (documento.contenido && documento.contenido.length > 300) {
      documento.contenido_resumido =
        documento.contenido.substring(0, 297) + "...";
    } else {
      documento.contenido_resumido = documento.contenido;
    }

    return documento;
  } catch (error) {
    logger.error(`Error al consultar info legal: ${error.message}`);
    return { error: "No pudimos obtener la información legal solicitada" };
  }
}

/**
 * Consulta redes sociales
 * @returns {object} - Datos de redes sociales
 */
async function consultarRedesSociales() {
  try {
    const query =
      "SELECT * FROM inf_redes_sociales WHERE activo = 1 ORDER BY nombre_red";
    const redes = await executeQuery(query);

    if (redes.length === 0) {
      return { redes: "No hay redes sociales registradas actualmente." };
    }

    // Formatear las redes para mostrarlas
    const redesFormateadas = redes
      .map((red) => `${red.nombre_red}: ${red.url}`)
      .join(", ");

    return {
      redes: redesFormateadas,
      redes_lista: redes,
    };
  } catch (error) {
    logger.error(`Error al consultar redes sociales: ${error.message}`);
    return { error: "No pudimos obtener la información de redes sociales" };
  }
}

/**
 * Consulta servicios disponibles
 * @returns {object} - Catálogo de servicios
 */
async function consultarServicios() {
  try {
    // Consulta modificada: se eliminó el filtro 'activo = 1' que causaba el problema
    const query = `
        SELECT id, title, description, category, price, duration, image_url
        FROM servicios
        ORDER BY category, title
      `;

    const servicios = await executeQuery(query);

    if (servicios.length === 0) {
      return {
        servicios: "No hay servicios registrados actualmente.",
      };
    }

    // Agrupar servicios por categoría
    const serviciosPorCategoria = {};

    servicios.forEach((s) => {
      if (!serviciosPorCategoria[s.category]) {
        serviciosPorCategoria[s.category] = [];
      }

      serviciosPorCategoria[s.category].push({
        id: s.id,
        nombre: s.title,
        precio: s.price,
        duracion: s.duration,
        descripcion: s.description,
      });
    });

    // Formatear para mostrar
    let listaServicios = "";

    for (const categoria in serviciosPorCategoria) {
      const serviciosTexto = serviciosPorCategoria[categoria]
        .map((s) => `${s.nombre} ($${s.precio})`)
        .join(", ");

      listaServicios += `${categoria}: ${serviciosTexto}. `;
    }

    // Lista de todos los nombres de servicios (útil para sugerencias)
    const todosServicios = servicios.map((s) => s.title);

    return {
      servicios: listaServicios,
      serviciosPorCategoria: serviciosPorCategoria,
      lista_servicios: todosServicios,
      total_servicios: servicios.length,
    };
  } catch (error) {
    logger.error(`Error al consultar servicios: ${error.message}`);
    return { error: "No pudimos obtener la información de servicios" };
  }
}
/**
 * Consulta el precio y detalles de un servicio específico
 * @param {string} nombreServicio - Nombre del servicio a consultar
 * @returns {object} - Datos del servicio
 */
async function consultarPrecioServicio(nombreServicio) {
  try {
    if (!nombreServicio) {
      return { error: "No se especificó ningún servicio" };
    }

    // Consulta principal para encontrar el servicio
    const query = `
      SELECT s.id, s.title, s.description, s.price, s.duration, s.category, s.image_url,
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
    const servicios = await executeQuery(query, [
      nombreServicio,
      `%${nombreServicio}%`,
      nombreServicio,
      `%${nombreServicio}%`,
    ]);

    if (servicios.length === 0) {
      // Si no encuentra el servicio, devolver servicios similares
      const catalogoServicios = await consultarServicios();

      let sugerencias = "No hay servicios similares disponibles.";

      if (
        !catalogoServicios.error &&
        catalogoServicios.lista_servicios?.length > 0
      ) {
        // Obtener hasta 5 servicios para sugerir
        sugerencias = catalogoServicios.lista_servicios.slice(0, 5).join(", ");
      }

      return {
        error: `No encontramos el servicio "${nombreServicio}"`,
        sugerencias: sugerencias,
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
      precio: servicio.price,
      duracion: servicio.duration || "Consultar",
      categoria: servicio.category,
      descripcion: servicio.description,
      tratamiento: servicio.tratamiento,
      detalles: detalles,
      beneficios: obtenerDetallesPorTipo(detalles, "beneficio"),
      incluye: obtenerDetallesPorTipo(detalles, "incluye"),
      precauciones: obtenerDetallesPorTipo(detalles, "precaucion"),
    };
  } catch (error) {
    logger.error(`Error al consultar precio servicio: ${error.stack}`);
    return { error: "No pudimos obtener el precio del servicio solicitado" };
  }
}

/**
 * Filtra los detalles de un servicio por tipo
 * @param {Array} detalles - Lista de detalles
 * @param {string} tipo - Tipo de detalle a filtrar
 * @returns {string} - Lista formateada
 */
function obtenerDetallesPorTipo(detalles, tipo) {
  if (!detalles || !Array.isArray(detalles) || detalles.length === 0) {
    return "";
  }

  const filtrados = detalles
    .filter((d) => d.tipo === tipo)
    .map((d) => d.descripcion);

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
      "acerca_de",
      "chatbot",
      "horarios",
      "inf_deslinde",
      "inf_perfil_empresa",
      "inf_politicas_privacidad",
      "inf_redes_sociales",
      "inf_terminos_condiciones",
      "preguntas_frecuentes",
      "servicios",
      "servicio_detalles",
    ];

    // Validar el nombre de la tabla para evitar SQL injection
    if (!tablasPermitidas.includes(tabla)) {
      return { error: "Tabla no permitida" };
    }

    // Validar el campo para evitar SQL injection
    if (campo !== "*" && !/^[a-zA-Z0-9_,\s]+$/.test(campo)) {
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
  const variables = (plantilla.match(/\{\{([^}]+)\}\}/g) || []).map((v) =>
    v.replace(/\{\{|\}\}/g, "")
  );

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
      const regex = new RegExp(`\\{\\{${variable}\\}\\}`, "g");
      resultado = resultado.replace(regex, valor);
    }
  }

  // Verificar si quedaron variables sin reemplazar
  const variablesFaltantes = resultado.match(/\{\{([^}]+)\}\}/g);

  if (variablesFaltantes) {
    // Reemplazar variables restantes con valores predeterminados o eliminarlas
    for (const variable of variablesFaltantes) {
      const nombreVar = variable.replace(/\{\{|\}\}/g, "");
      const valorPredeterminado = obtenerValorPredeterminado(nombreVar, datos);

      const regex = new RegExp(`\\{\\{${nombreVar}\\}\\}`, "g");
      resultado = resultado.replace(regex, valorPredeterminado);
    }
  }

  // Si hay un mensaje de error, agregarlo al final
  if (datos.error && !resultado.includes(datos.error)) {
    if (
      !resultado.endsWith(".") &&
      !resultado.endsWith("?") &&
      !resultado.endsWith("!")
    ) {
      resultado += ".";
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
    servicio: ["title", "nombre", "nombre_servicio"],
    precio: ["price", "precio_servicio", "costo"],
    duracion: ["duration", "tiempo", "minutos"],
    horarios: ["horario", "horas_atencion"],
    redes: ["redes_sociales", "redes_lista"],
    direccion: ["calle_numero", "ubicacion", "domicilio", "direccion_completa"],
    telefono: ["telefono_principal", "contacto", "celular"],
    descripcion: ["description", "contenido", "detalle"],
    categoria: ["category", "tipo"],
    contenido: ["descripcion", "description", "texto"],
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
    case "servicio":
    case "nombre":
    case "title":
      return "este servicio";

    case "precio":
    case "price":
      return "consultar precio en clínica";

    case "duracion":
    case "duration":
      return "variable según paciente";

    case "horarios":
      return "horario de atención regular";

    case "descripcion":
    case "description":
    case "contenido":
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

    return res.json({
      preguntas,
      total: preguntas.length,
    });
  } catch (error) {
    logger.error(`Error al obtener preguntas frecuentes: ${error.message}`);
    return res
      .status(500)
      .json({ error: "Error al obtener preguntas frecuentes" });
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

    // Agrupar por categoría para facilitar el uso en el frontend
    const agrupados = {};

    patrones.forEach((p) => {
      if (!agrupados[p.categoria]) {
        agrupados[p.categoria] = [];
      }
      agrupados[p.categoria].push(p);
    });

    return res.json({
      patrones,
      patrones_por_categoria: agrupados,
      total: patrones.length,
    });
  } catch (error) {
    logger.error(`Error al obtener patrones: ${error.message}`);
    return res.status(500).json({ error: "Error al obtener patrones" });
  }
});

/**
 * Endpoint para obtener información de servicios
 */
router.get("/servicios", async (req, res) => {
  try {
    const { categoria } = req.query;
    let datos;

    if (categoria) {
      // Filtrar por categoría específica
      datos = await consultarServiciosPorCategoria(categoria);
    } else {
      // Todos los servicios
      datos = await consultarServicios();
    }

    return res.json(datos);
  } catch (error) {
    logger.error(`Error al obtener servicios: ${error.message}`);
    return res.status(500).json({ error: "Error al obtener servicios" });
  }
});

/**
 * Consulta servicios por categoría
 * @param {string} categoria - Categoría a consultar
 * @returns {object} - Datos de servicios
 */
async function consultarServiciosPorCategoria(categoria) {
  try {
    const query = `
      SELECT id, title, description, category, price, duration, image_url
      FROM servicios
      WHERE category = ? AND activo = 1
      ORDER BY title
    `;

    const servicios = await executeQuery(query, [categoria]);

    if (servicios.length === 0) {
      return {
        error: `No hay servicios en la categoría ${categoria}`,
        servicios: [],
      };
    }

    return {
      servicios: servicios,
      categoria: categoria,
      total: servicios.length,
    };
  } catch (error) {
    logger.error(
      `Error al consultar servicios por categoría: ${error.message}`
    );
    throw error;
  }
}

/**
 * Endpoint para obtener precio de un servicio
 */
router.get("/precio-servicio", async (req, res) => {
  try {
    const { nombre } = req.query;

    if (!nombre) {
      return res
        .status(400)
        .json({ error: "Debe especificar el nombre del servicio" });
    }

    const datos = await consultarPrecioServicio(nombre);
    return res.json(datos);
  } catch (error) {
    logger.error(`Error al obtener precio: ${error.message}`);
    return res
      .status(500)
      .json({ error: "Error al obtener el precio del servicio" });
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
      return res.json(datos);
    } else {
      // Consultar todos los horarios
      const datos = await consultarHorarios();
      return res.json(datos);
    }
  } catch (error) {
    logger.error(`Error al obtener horarios: ${error.message}`);
    return res.status(500).json({ error: "Error al obtener horarios" });
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
    const diaNormalizado =
      dia.charAt(0).toUpperCase() + dia.slice(1).toLowerCase();

    // Mapeo de posibles variaciones
    const mapDias = {
      lun: "Lunes",
      mar: "Martes",
      mie: "Miércoles",
      jue: "Jueves",
      vie: "Viernes",
      sab: "Sábado",
      dom: "Domingo",
    };

    // Obtener el día completo si es una abreviatura
    const diaConsulta =
      mapDias[diaNormalizado.substring(0, 3)] || diaNormalizado;

    // Validar que sea un día válido
    const diasValidos = [
      "Lunes",
      "Martes",
      "Miércoles",
      "Jueves",
      "Viernes",
      "Sábado",
      "Domingo",
    ];

    if (!diasValidos.includes(diaConsulta)) {
      return {
        error: "Día no válido. Debe ser uno de: " + diasValidos.join(", "),
        dia: diaNormalizado,
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
        mensaje: `No hay horarios disponibles para ${diaConsulta}`,
        dia: diaConsulta,
        horarios: [],
      };
    }

    // Formatear horarios para este día
    const horariosFormateados = horarios.map((h) => {
      const horaInicio = h.hora_inicio?.substring(0, 5) || "";
      const horaFin = h.hora_fin?.substring(0, 5) || "";

      return {
        horario: `${horaInicio} - ${horaFin}`,
        empleado: h.nombre_empleado || "General",
        duracion: h.duracion || 0,
      };
    });

    // Generar texto formateado
    const textoHorarios = horariosFormateados
      .map((h) => h.horario)
      .filter((v, i, a) => a.indexOf(v) === i) // Eliminar duplicados
      .join(", ");

    return {
      dia: diaConsulta,
      horarios: horariosFormateados,
      texto_horarios: `${diaConsulta}: ${textoHorarios}`,
    };
  } catch (error) {
    logger.error(`Error al consultar horario por día: ${error.message}`);
    return { error: `No pudimos obtener los horarios para ${dia}` };
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
      return res.status(404).json({ error: "Perfil de empresa no encontrado" });
    }

    const empresa = resultado[0];

    // Formatear dirección completa
    if (empresa.calle_numero && empresa.localidad) {
      empresa.direccion_completa = `${empresa.calle_numero}, ${
        empresa.localidad
      }, ${empresa.municipio || ""}, ${empresa.estado || ""}, C.P. ${
        empresa.codigo_postal || ""
      }`
        .replace(/,\s+,/g, ",")
        .replace(/,\s+$/g, "");
    }

    return res.json(empresa);
  } catch (error) {
    logger.error(`Error al obtener perfil de empresa: ${error.message}`);
    return res
      .status(500)
      .json({ error: "Error al obtener perfil de empresa" });
  }
});

/**
 * Endpoint para obtener acerca de (historia, misión, etc.)
 */
router.get("/acerca-de/:tipo", async (req, res) => {
  try {
    let { tipo } = req.params;

    // Validar el tipo
    const tiposPermitidos = ["Historia", "Misión", "Visión", "Valores"];
    tipo = tipo.charAt(0).toUpperCase() + tipo.slice(1).toLowerCase();

    // Verificar abreviaturas comunes
    if (tipo === "Mision") tipo = "Misión";
    if (tipo === "Vision") tipo = "Visión";

    if (!tiposPermitidos.includes(tipo)) {
      return res.status(400).json({
        error: "Tipo no válido",
        tipos_permitidos: tiposPermitidos,
      });
    }

    const query =
      "SELECT * FROM acerca_de WHERE tipo = ? ORDER BY fecha_actualizacion DESC LIMIT 1";
    const resultado = await executeQuery(query, [tipo]);

    if (resultado.length === 0) {
      return res
        .status(404)
        .json({ error: `No se encontró información sobre ${tipo}` });
    }

    return res.json(resultado[0]);
  } catch (error) {
    logger.error(`Error al obtener acerca de: ${error.message}`);
    return res.status(500).json({ error: "Error al obtener información" });
  }
});

/**
 * Endpoint para obtener redes sociales
 */
router.get("/redes-sociales", async (req, res) => {
  try {
    const datos = await consultarRedesSociales();
    return res.json(datos);
  } catch (error) {
    logger.error(`Error al obtener redes sociales: ${error.message}`);
    return res.status(500).json({ error: "Error al obtener redes sociales" });
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
      case "deslinde":
        tabla = "inf_deslinde";
        break;
      case "terminos":
      case "términos":
      case "condiciones":
        tabla = "inf_terminos_condiciones";
        break;
      case "privacidad":
      case "politicas":
      case "políticas":
        tabla = "inf_politicas_privacidad";
        break;
      default:
        return res.status(400).json({
          error: "Tipo no válido",
          tipos_permitidos: ["deslinde", "terminos", "privacidad"],
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
      return res.status(404).json({ error: "Documento legal no encontrado" });
    }

    return res.json(resultado[0]);
  } catch (error) {
    logger.error(`Error al obtener documento legal: ${error.message}`);
    return res.status(500).json({ error: "Error al obtener documento legal" });
  }
});

/**
 * Endpoint para verificar si el servicio está activo
 */
router.get("/status", (req, res) => {
  return res.json({
    status: "online",
    mensaje: "Chatbot dental funcionando correctamente",
    version: "2.0.0",
    timestamp: new Date(),
  });
});

/**
 * Endpoint para administración: agregar o actualizar un patrón
 */
router.post("/admin/patron", async (req, res) => {
  try {
    const {
      id,
      patron,
      categoria,
      respuestas,
      es_plantilla,
      tabla_consulta,
      campo_consulta,
      condicion,
      prioridad,
      comentario,
    } = req.body;

    // Validar datos obligatorios
    if (!patron || !categoria || !respuestas) {
      return res
        .status(400)
        .json({
          error: "Faltan datos obligatorios (patron, categoria, respuestas)",
        });
    }

    // Validar categoría
    const categoriasPermitidas = [
      "General",
      "Servicios",
      "Citas",
      "Precios",
      "Horario",
      "Contacto",
      "Ubicacion",
      "Redes",
      "Empresa",
      "Legal",
    ];

    if (!categoriasPermitidas.includes(categoria)) {
      return res.status(400).json({
        error: "Categoría no válida",
        categorias_permitidas: categoriasPermitidas,
      });
    }

    // Si tiene ID, actualizar; si no, insertar
    if (id) {
      const query = `
        UPDATE chatbot SET
        patron = ?,
        categoria = ?,
        respuestas = ?,
        es_plantilla = ?,
        tabla_consulta = ?,
        campo_consulta = ?,
        condicion = ?,
        prioridad = ?,
        comentario = ?,
        fecha_actualizacion = NOW()
        WHERE id = ?
      `;

      await executeQuery(query, [
        patron,
        categoria,
        respuestas,
        es_plantilla ? 1 : 0,
        tabla_consulta || null,
        campo_consulta || null,
        condicion || null,
        prioridad || 5,
        comentario || null,
        id,
      ]);

      return res.json({
        mensaje: "Patrón actualizado correctamente",
        id,
        patron,
        categoria,
      });
    } else {
      const query = `
        INSERT INTO chatbot
        (patron, categoria, respuestas, es_plantilla, tabla_consulta, campo_consulta, condicion, prioridad, comentario, fecha_creacion)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `;

      const result = await executeQuery(query, [
        patron,
        categoria,
        respuestas,
        es_plantilla ? 1 : 0,
        tabla_consulta || null,
        campo_consulta || null,
        condicion || null,
        prioridad || 5,
        comentario || null,
      ]);

      return res.json({
        mensaje: "Patrón agregado correctamente",
        id: result.insertId,
        patron,
        categoria,
      });
    }
  } catch (error) {
    logger.error(`Error en administración de patrones: ${error.message}`);
    return res.status(500).json({ error: "Error al procesar el patrón" });
  }
});

/**
 * Endpoint para administración: eliminar un patrón
 */
router.delete("/admin/patron/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener información del patrón antes de eliminarlo
    const queryInfo = "SELECT patron, categoria FROM chatbot WHERE id = ?";
    const infoResultado = await executeQuery(queryInfo, [id]);

    if (infoResultado.length === 0) {
      return res.status(404).json({ error: "Patrón no encontrado" });
    }

    const { patron, categoria } = infoResultado[0];

    // Eliminar el patrón
    const query = "DELETE FROM chatbot WHERE id = ?";
    const result = await executeQuery(query, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "No se pudo eliminar el patrón" });
    }

    return res.json({
      mensaje: "Patrón eliminado correctamente",
      patron,
      categoria,
    });
  } catch (error) {
    logger.error(`Error al eliminar patrón: ${error.message}`);
    return res.status(500).json({ error: "Error al eliminar patrón" });
  }
});

/**
 * Endpoint para administración: listar categorías de patrones
 */
router.get("/admin/categorias", async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT categoria, COUNT(*) as total
      FROM chatbot
      GROUP BY categoria
      ORDER BY categoria
    `;

    const categorias = await executeQuery(query);

    return res.json({ categorias });
  } catch (error) {
    logger.error(`Error al obtener categorías: ${error.message}`);
    return res.status(500).json({ error: "Error al obtener categorías" });
  }
});

/**
 * Endpoint para guardar una consulta sin respuesta (aprendizaje)
 */
router.post("/aprendizaje", async (req, res) => {
  try {
    const { mensaje, fecha } = req.body;

    if (!mensaje) {
      return res.status(400).json({ error: "El mensaje no puede estar vacío" });
    }

    const query = `
      INSERT INTO chatbot_aprendizaje (mensaje, fecha, estado)
      VALUES (?, ?, 'nuevo')
    `;

    const result = await executeQuery(query, [mensaje, fecha || new Date()]);

    return res.json({
      mensaje: "Consulta guardada para aprendizaje",
      id: result.insertId,
    });
  } catch (error) {
    logger.error(`Error al guardar aprendizaje: ${error.message}`);
    return res.status(500).json({ error: "Error al guardar la consulta" });
  }
});

/**
 * Endpoint para obtener estadísticas del chatbot
 */
router.get("/estadisticas", async (req, res) => {
  try {
    // Total de patrones por categoría
    const queryPatrones = `
      SELECT categoria, COUNT(*) as total
      FROM chatbot
      GROUP BY categoria
      ORDER BY total DESC
    `;

    const patrones = await executeQuery(queryPatrones);

    // Total de servicios por categoría
    const queryServicios = `
      SELECT category, COUNT(*) as total
      FROM servicios
      WHERE activo = 1
      GROUP BY category
      ORDER BY total DESC
    `;

    const servicios = await executeQuery(queryServicios);

    // Consultas recientes sin respuesta
    const querySinRespuesta = `
      SELECT mensaje, fecha, id
      FROM chatbot_aprendizaje
      WHERE estado = 'nuevo'
      ORDER BY fecha DESC
      LIMIT 10
    `;

    const sinRespuesta = await executeQuery(querySinRespuesta);

    return res.json({
      patrones: {
        porCategoria: patrones,
        total: patrones.reduce((sum, item) => sum + item.total, 0),
      },
      servicios: {
        porCategoria: servicios,
        total: servicios.reduce((sum, item) => sum + item.total, 0),
      },
      sinRespuesta: {
        consultas: sinRespuesta,
        total: sinRespuesta.length,
      },
    });
  } catch (error) {
    logger.error(`Error al obtener estadísticas: ${error.message}`);
    return res.status(500).json({ error: "Error al obtener estadísticas" });
  }
});

module.exports = router;
