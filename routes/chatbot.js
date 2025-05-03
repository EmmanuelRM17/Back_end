const express = require("express");
const router = express.Router();
const db = require("../db");
const logger = require("../utils/logger");

// Función para ejecutar consultas a la base de datos como Promesas
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

// Función para buscar patrones en la BD
const buscarPatron = async (mensaje) => {
  try {
    // Normalizar el mensaje (minúsculas, sin espacios extras)
    const mensajeNormalizado = mensaje.toLowerCase().trim();
    
    // Consultar la tabla de chatbot para buscar coincidencias con cualquier patrón
    const query = `
      SELECT * FROM chatbot 
      WHERE 
        patron = ? OR 
        ? LIKE CONCAT('%', patron, '%')
      ORDER BY prioridad DESC, LENGTH(patron) DESC
      LIMIT 1
    `;
    
    const resultados = await executeQuery(query, [mensajeNormalizado, mensajeNormalizado]);
    
    // Si encontramos un patrón, devolver su información
    if (resultados && resultados.length > 0) {
      return resultados[0];
    }
    
    return null;
  } catch (error) {
    logger.error(`Error al buscar patrón: ${error.message}`);
    throw error;
  }
};

// Función para obtener una respuesta aleatoria del conjunto de respuestas
const obtenerRespuestaAleatoria = (respuestas) => {
  if (!respuestas) return "¡Hola! Bienvenido a Odontología Carol. ¿Cómo puedo ayudarte hoy?";
  
  // Dividir las respuestas (están separadas por |||)
  const arrayRespuestas = respuestas.split('|||').map(r => r.trim());
  
  // Elegir una respuesta aleatoria
  const indiceAleatorio = Math.floor(Math.random() * arrayRespuestas.length);
  return arrayRespuestas[indiceAleatorio];
};

// ====== FUNCIONES DINÁMICAS PARA CONSULTA DE SERVICIOS ======

// Función para obtener todas las categorías disponibles dinámicamente
const obtenerCategorias = async () => {
  try {
    const query = `
      SELECT DISTINCT category 
      FROM servicios 
      WHERE category IS NOT NULL AND category != ''
    `;
    
    const resultados = await executeQuery(query);
    return resultados.map(row => row.category);
  } catch (error) {
    logger.error(`Error al obtener categorías: ${error.message}`);
    return [];
  }
};

// Función para buscar servicios por nombre o palabras clave (dinámica)
const buscarServicios = async (palabrasClave) => {
  try {
    const terminos = palabrasClave.toLowerCase().trim().split(/\s+/);
    
    // Construir condiciones de búsqueda
    const condiciones = terminos.map(termino => 
      `(LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(category) LIKE ?)`
    ).join(' AND ');
    
    const parametros = [];
    terminos.forEach(termino => {
      parametros.push(`%${termino}%`, `%${termino}%`, `%${termino}%`);
    });
    
    const query = `
      SELECT id, title, description, category, duration, price, image_url, tratamiento 
      FROM servicios 
      WHERE ${condiciones}
      LIMIT 5
    `;
    
    return await executeQuery(query, parametros);
  } catch (error) {
    logger.error(`Error al buscar servicios: ${error.message}`);
    return [];
  }
};

// Función para obtener servicios por categoría
const obtenerServiciosPorCategoria = async (categoria) => {
  try {
    const query = `
      SELECT id, title, description, category, duration, price, tratamiento 
      FROM servicios 
      WHERE LOWER(category) = LOWER(?)
      ORDER BY tratamiento DESC, price ASC
    `;
    
    return await executeQuery(query, [categoria]);
  } catch (error) {
    logger.error(`Error al obtener servicios por categoría: ${error.message}`);
    return [];
  }
};

// Función para obtener detalles de un servicio
const obtenerDetallesServicio = async (servicioId) => {
  try {
    const query = `
      SELECT sd.id, sd.tipo, sd.descripcion 
      FROM servicio_detalles sd
      WHERE sd.servicio_id = ?
      ORDER BY sd.tipo, sd.id
    `;
    
    return await executeQuery(query, [servicioId]);
  } catch (error) {
    logger.error(`Error al obtener detalles del servicio: ${error.message}`);
    return [];
  }
};

// Función para obtener todos los servicios (por categoría)
const obtenerTodosServicios = async () => {
  try {
    const query = `
      SELECT id, title, category, price, tratamiento, 
             citasEstimadas, duration
      FROM servicios 
      ORDER BY category, tratamiento DESC, price
    `;
    
    return await executeQuery(query);
  } catch (error) {
    logger.error(`Error al obtener todos los servicios: ${error.message}`);
    return [];
  }
};

// Función para construir respuesta sobre servicios
const construirRespuestaServicio = async (servicios, incluirDetalles = false) => {
  let respuesta = "";
  
  if (servicios.length === 0) {
    return "Lo siento, no encontré servicios que coincidan con tu búsqueda.";
  }
  
  if (servicios.length === 1) {
    // Respuesta detallada para un solo servicio
    const servicio = servicios[0];
    respuesta = `📍 **${servicio.title}**\n`;
    respuesta += `Categoría: ${servicio.category}\n`;
    
    if (servicio.duration) {
      respuesta += `Duración aproximada: ${servicio.duration}\n`;
    }
    
    respuesta += `Precio: $${servicio.price}\n`;
    
    if (servicio.tratamiento === 1) {
      respuesta += `Tipo: Tratamiento completo`;
      
      if (servicio.citasEstimadas) {
        respuesta += ` (aproximadamente ${servicio.citasEstimadas} citas)\n`;
      } else {
        respuesta += `\n`;
      }
    } else {
      respuesta += `Tipo: Servicio individual\n`;
    }
    
    respuesta += `\n${servicio.description}\n`;
    
    if (incluirDetalles) {
      const detalles = await obtenerDetallesServicio(servicio.id);
      
      // Agrupar por tipo
      const beneficios = detalles.filter(d => d.tipo === 'beneficio');
      const incluye = detalles.filter(d => d.tipo === 'incluye');
      const preparacion = detalles.filter(d => d.tipo === 'preparacion');
      const cuidado = detalles.filter(d => d.tipo === 'cuidado');
      
      if (beneficios.length > 0) {
        respuesta += "\n✅ **Beneficios**:\n";
        beneficios.forEach(b => respuesta += `- ${b.descripcion}\n`);
      }
      
      if (incluye.length > 0) {
        respuesta += "\n📋 **Incluye**:\n";
        incluye.forEach(i => respuesta += `- ${i.descripcion}\n`);
      }
      
      if (preparacion.length > 0) {
        respuesta += "\n🔍 **Preparación**:\n";
        preparacion.forEach(p => respuesta += `- ${p.descripcion}\n`);
      }
      
      if (cuidado.length > 0) {
        respuesta += "\n🛡️ **Cuidados**:\n";
        cuidado.forEach(c => respuesta += `- ${c.descripcion}\n`);
      }
    }
  } else {
    // Listado resumido para múltiples servicios
    respuesta = "He encontrado los siguientes servicios:\n\n";
    
    // Agrupar por categoría
    const porCategoria = {};
    servicios.forEach(s => {
      if (!porCategoria[s.category]) {
        porCategoria[s.category] = [];
      }
      porCategoria[s.category].push(s);
    });
    
    for (const categoria in porCategoria) {
      respuesta += `**${categoria}**:\n`;
      
      // Separar tratamientos y servicios individuales
      const tratamientos = porCategoria[categoria].filter(s => s.tratamiento === 1);
      const serviciosIndividuales = porCategoria[categoria].filter(s => s.tratamiento !== 1);
      
      if (tratamientos.length > 0) {
        respuesta += `\n⚕️ *Tratamientos*:\n`;
        tratamientos.forEach(s => {
          let infoAdicional = "";
          if (s.citasEstimadas) {
            infoAdicional = ` (${s.citasEstimadas} citas aprox.)`;
          }
          respuesta += `- ${s.title}: $${s.price}${infoAdicional}\n`;
        });
      }
      
      if (serviciosIndividuales.length > 0) {
        respuesta += `\n🔹 *Servicios*:\n`;
        serviciosIndividuales.forEach(s => {
          respuesta += `- ${s.title}: $${s.price}\n`;
        });
      }
      
      respuesta += "\n";
    }
    
    respuesta += "Para más detalles sobre algún servicio específico, puedes preguntar por su nombre.";
  }
  
  return respuesta;
};

// Función para detectar consultas sobre servicios (dinámica)
const detectarConsultaServicios = async (mensaje) => {
  const mensajeLower = mensaje.toLowerCase().trim();
  
  // Patrones generales para detectar consultas sobre servicios
  const patronesServicio = [
    /servicio/i, /tratamiento/i, /procedimiento/i,
    /precio/i, /costo/i, /cuánto cuesta/i, /valor/i,
    /qué ofrec/i, /tienen/i, /hacen/i, /realizan/i
  ];
  
  // Obtener categorías dinámicamente
  const categorias = await obtenerCategorias();
  const patronesCategoria = {};
  
  // Crear patrones dinámicos para cada categoría
  categorias.forEach(categoria => {
    const categoriaLower = categoria.toLowerCase();
    patronesCategoria[categoria] = [
      new RegExp(categoriaLower, 'i'),
      new RegExp(`qué (servicios|tratamientos) de ${categoriaLower}`, 'i')
    ];
    
    // Añadir patrones específicos por categoría conocida
    switch (categoriaLower) {
      case 'higiene':
        patronesCategoria[categoria].push(/limpieza/i, /profilaxis/i);
        break;
      case 'ortodoncia':
        patronesCategoria[categoria].push(/bracket/i, /alineador/i, /frenos/i);
        break;
      case 'estética':
        patronesCategoria[categoria].push(/blanqueamiento/i, /diseño de sonrisa/i);
        break;
      case 'cirugía':
        patronesCategoria[categoria].push(/extracción/i, /muela/i, /cordal/i);
        break;
      case 'restauración':
        patronesCategoria[categoria].push(/empaste/i, /resina/i, /obturación/i);
        break;
      case 'prótesis':
        patronesCategoria[categoria].push(/corona/i, /puente/i, /removible/i);
        break;
      case 'periodoncia':
        patronesCategoria[categoria].push(/encía/i, /curetaje/i, /periodont/i);
        break;
      case 'preventivo':
        patronesCategoria[categoria].push(/guarda/i, /prevención/i, /sellador/i);
        break;
      case 'general':
        patronesCategoria[categoria].push(/consulta general/i, /revisión/i);
        break;
    }
  });
  
  // Verificar si es una consulta sobre servicios
  let esConsultaServicio = patronesServicio.some(patron => patron.test(mensajeLower));
  
  // Verificar si es una consulta sobre categoría específica
  let categoria = null;
  for (const cat in patronesCategoria) {
    if (patronesCategoria[cat].some(patron => patron.test(mensajeLower))) {
      categoria = cat;
      esConsultaServicio = true;
      break;
    }
  }
  
  // Verificar si es una consulta de listado
  const esConsultaListado = /todos los( servicios| tratamientos)|lista de( servicios| tratamientos)|qué ofrecen|catálogo/i.test(mensajeLower);
  
  // Verificar si es consulta de tratamientos específicamente
  const esSoloTratamientos = /tratamientos|procedimientos completos/i.test(mensajeLower) && 
                            !/servicios/i.test(mensajeLower);
  
  // Verificar si es consulta de servicios individuales
  const esSoloServicios = /servicios individuales|no tratamientos/i.test(mensajeLower);
  
  // Verificar si es consulta de precios
  const esConsultaPrecios = /precios|costos|tarifas|cuánto cuesta/i.test(mensajeLower);
  
  return {
    esConsultaServicio,
    esConsultaListado,
    esConsultaPrecios,
    esSoloTratamientos,
    esSoloServicios,
    categoria,
    palabrasClave: mensajeLower
  };
};

// Función principal para procesar los mensajes
const procesarMensaje = async (mensaje, contexto) => {
  try {
    // Por defecto, preparamos una respuesta genérica
    let respuesta = {
      respuesta: "Lo siento, no entiendo tu mensaje. ¿Puedo ayudarte con algo sobre Odontología Carol?",
      tipo: "General",
      subtipo: "no_entendido",
      contexto: contexto || {}
    };
    
    // Primero detectar si es una consulta sobre servicios
    const consultaServicio = await detectarConsultaServicios(mensaje);
    
    if (consultaServicio.esConsultaServicio) {
      // Es una consulta relacionada con servicios
      let serviciosResultado = [];
      
      if (consultaServicio.esConsultaListado) {
        // Listado de todos los servicios
        serviciosResultado = await obtenerTodosServicios();
        
        // Filtrar si solo quiere tratamientos o servicios individuales
        if (consultaServicio.esSoloTratamientos) {
          serviciosResultado = serviciosResultado.filter(s => s.tratamiento === 1);
        } else if (consultaServicio.esSoloServicios) {
          serviciosResultado = serviciosResultado.filter(s => s.tratamiento !== 1);
        }
        
        logger.info(`Solicitado listado de servicios - Filtros: ${
          consultaServicio.esSoloTratamientos ? 'solo tratamientos' : 
          consultaServicio.esSoloServicios ? 'solo servicios individuales' : 
          'todos'
        }`);
      } else if (consultaServicio.categoria) {
        // Servicios de una categoría específica
        serviciosResultado = await obtenerServiciosPorCategoria(consultaServicio.categoria);
        
        // Filtrar si solo quiere tratamientos o servicios individuales
        if (consultaServicio.esSoloTratamientos) {
          serviciosResultado = serviciosResultado.filter(s => s.tratamiento === 1);
        } else if (consultaServicio.esSoloServicios) {
          serviciosResultado = serviciosResultado.filter(s => s.tratamiento !== 1);
        }
        
        logger.info(`Solicitados servicios de categoría: ${consultaServicio.categoria}`);
      } else {
        // Búsqueda por palabras clave
        serviciosResultado = await buscarServicios(consultaServicio.palabrasClave);
        logger.info(`Búsqueda de servicios por palabras clave: ${consultaServicio.palabrasClave}`);
      }
      
      if (serviciosResultado.length > 0) {
        // Construir respuesta detallada
        const textoRespuesta = await construirRespuestaServicio(
          serviciosResultado, 
          serviciosResultado.length === 1 // Incluir detalles solo si es un servicio
        );
        
        respuesta = {
          respuesta: textoRespuesta,
          tipo: "Servicios",
          subtipo: consultaServicio.categoria || "busqueda",
          datos: {
            servicios_encontrados: serviciosResultado.length,
            categoria: consultaServicio.categoria,
            es_tratamiento: consultaServicio.esSoloTratamientos
          },
          contexto: {
            ...contexto,
            ultima_busqueda_servicios: consultaServicio.palabrasClave,
            ultima_categoria: consultaServicio.categoria
          }
        };
        
        return respuesta;
      }
    }
    
    // Si no es una consulta de servicios o no encontramos servicios,
    // buscamos un patrón normal como antes
    const patronEncontrado = await buscarPatron(mensaje);
    
    if (patronEncontrado) {
      // Si encontramos un patrón, generamos una respuesta
      const respuestaAleatoria = obtenerRespuestaAleatoria(patronEncontrado.respuestas);
      
      respuesta = {
        respuesta: respuestaAleatoria,
        tipo: patronEncontrado.categoria,
        subtipo: patronEncontrado.patron, // Usamos el patrón como subtipo
        datos: {
          patron_detectado: patronEncontrado.patron,
          prioridad: patronEncontrado.prioridad,
          categoria: patronEncontrado.categoria
        },
        contexto: {
          ...contexto,
          ultimo_patron: patronEncontrado.patron,
          ultima_categoria: patronEncontrado.categoria
        }
      };
      
      logger.info(`Patrón detectado: "${patronEncontrado.patron}" - Categoría: "${patronEncontrado.categoria}" - Respondiendo`);
    } else {
      logger.info(`No se detectó patrón en el mensaje: "${mensaje.substring(0, 30)}..."`);
    }
    
    return respuesta;
  } catch (error) {
    logger.error(`Error al procesar mensaje: ${error.message}`);
    throw error;
  }
};

// Endpoint principal para procesar mensajes del chatbot
router.post("/mensaje", async (req, res) => {
  try {
    const { mensaje, contexto = {} } = req.body;
    
    // Validación básica
    if (!mensaje || mensaje.trim() === "") {
      return res.status(400).json({
        error: "El mensaje no puede estar vacío",
        status: "error"
      });
    }
    
    // Mejorar el manejo de contexto
    const contextoActualizado = {
      ...contexto,
      ultimas_entidades: contexto.entidades || {},
      ultimo_mensaje: contexto.mensaje || "",
      contador_interacciones: (contexto.contador_interacciones || 0) + 1
    };
    
    // Procesamos el mensaje y obtenemos respuesta
    const respuesta = await procesarMensaje(mensaje, contextoActualizado);
    
    // Actualizar contexto para la siguiente interacción
    const nuevoContexto = {
      ...respuesta.contexto,
      mensaje: mensaje,
      entidades: respuesta.entidades,
      tipo_respuesta: respuesta.tipo,
      timestamp: new Date().toISOString()
    };
    
    logger.info(`Mensaje procesado: "${mensaje.substring(0, 50)}..." - Tipo: ${respuesta.tipo}`);
    
    return res.json({
      ...respuesta,
      contexto: nuevoContexto
    });
    
  } catch (error) {
    logger.error(`Error en /chatbot/mensaje: ${error.message}`);
    return res.status(500).json({
      error: "Error al procesar el mensaje",
      mensaje: "Lo siento, tuve un problema al procesar tu consulta. ¿Podrías intentarlo de nuevo?",
      status: "error"
    });
  }
});

// Endpoint adicional para obtener patrones disponibles (útil para pruebas)
router.get("/patrones", async (req, res) => {
  try {
    const query = `
      SELECT id, patron, categoria, prioridad 
      FROM chatbot 
      ORDER BY categoria, prioridad DESC, patron ASC
    `;
    
    const patrones = await executeQuery(query);
    
    return res.json({
      patrones,
      total: patrones.length,
      status: "success"
    });
  } catch (error) {
    logger.error(`Error en /chatbot/patrones: ${error.message}`);
    return res.status(500).json({
      error: "Error al consultar patrones",
      status: "error"
    });
  }
});

// Endpoint para obtener servicios (útil para pruebas)
router.get("/servicios", async (req, res) => {
  try {
    const { categoria, q } = req.query;
    
    let servicios = [];
    
    if (categoria) {
      servicios = await obtenerServiciosPorCategoria(categoria);
    } else if (q) {
      servicios = await buscarServicios(q);
    } else {
      servicios = await obtenerTodosServicios();
    }
    
    return res.json({
      servicios,
      total: servicios.length,
      status: "success"
    });
  } catch (error) {
    logger.error(`Error en /chatbot/servicios: ${error.message}`);
    return res.status(500).json({
      error: "Error al consultar servicios",
      status: "error"
    });
  }
});

// Endpoint para obtener categorías disponibles
router.get("/categorias", async (req, res) => {
  try {
    const categorias = await obtenerCategorias();
    
    return res.json({
      categorias,
      total: categorias.length,
      status: "success"
    });
  } catch (error) {
    logger.error(`Error en /chatbot/categorias: ${error.message}`);
    return res.status(500).json({
      error: "Error al consultar categorías",
      status: "error"
    });
  }
});

module.exports = router;