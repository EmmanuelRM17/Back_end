const express = require("express");
const router = express.Router();
const db = require("../db");
const logger = require("../utils/logger");

// Función para ejecutar consultas a la base de datos (Promise)
const executeQuery = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) {
        logger.error(`Error en consulta SQL: ${err.message}`);
        reject(err);
        return;
      }
      resolve(results);
    });
  });
};

/**
 * Endpoint principal para procesar mensajes del chatbot
 * Detecta intenciones y devuelve respuestas dinámicas
 */
router.post("/mensaje", async (req, res) => {
  try {
    const { mensaje } = req.body;
    
    if (!mensaje || mensaje.trim() === "") {
      return res.status(400).json({ error: "El mensaje no puede estar vacío" });
    }
    
    // Procesamos el mensaje y obtenemos respuesta
    const respuesta = await procesarMensaje(mensaje);
    return res.json(respuesta);
    
  } catch (error) {
    logger.error(`Error en /chatbot/mensaje: ${error.message}`);
    return res.status(500).json({ 
      error: "Error al procesar el mensaje",
      mensaje: "Lo siento, tuve un problema al procesar tu consulta. ¿Podrías intentarlo de nuevo?" 
    });
  }
});

/**
 * Procesa el mensaje del usuario y genera una respuesta apropiada
 */
async function procesarMensaje(mensaje) {
  try {
    // Normalizar el mensaje (minúsculas, quitar caracteres especiales)
    const mensajeNormalizado = mensaje.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    
    // 1. Buscar intenciones que coincidan con el mensaje
    const intencion = await buscarIntencion(mensajeNormalizado);
    
    // Si no encontramos ninguna intención, devolvemos respuesta por defecto
    if (!intencion) {
      return {
        respuesta: "Lo siento, no entendí tu consulta. ¿Podrías ser más específico o preguntar de otra manera?",
        tipo: "default",
        datos: null
      };
    }
    
    // 2. Generar respuesta según la intención
    return await generarRespuesta(intencion, mensajeNormalizado);
    
  } catch (error) {
    logger.error(`Error al procesar mensaje: ${error.message}`);
    throw error;
  }
}

/**
 * Busca una intención que coincida con el mensaje del usuario
 */
async function buscarIntencion(mensaje) {
  try {
    // Consulta para encontrar intenciones que coincidan con el mensaje
    // Ahora buscamos en la tabla única "chatbot"
    const query = `
      SELECT * FROM chatbot 
      WHERE ? LIKE CONCAT('%', patron, '%') 
      ORDER BY prioridad DESC, LENGTH(patron) DESC
      LIMIT 1
    `;
    
    const intenciones = await executeQuery(query, [mensaje]);
    
    if (intenciones.length === 0) {
      return null;
    }
    
    return intenciones[0];
    
  } catch (error) {
    logger.error(`Error al buscar intención: ${error.message}`);
    throw error;
  }
}

/**
 * Genera una respuesta basada en la intención detectada
 */
async function generarRespuesta(intencion, mensaje) {
  try {
    // 1. Verificar si la intención requiere una consulta a la base de datos
    let datosConsulta = null;
    
    if (intencion.tabla_consulta) {
      // Obtener datos específicos según la categoría de la intención
      switch (intencion.categoria) {
        case 'Horario':
          datosConsulta = await consultarHorarios();
          break;
        case 'Redes':
          datosConsulta = await consultarRedesSociales();
          break;
        case 'Empresa':
          datosConsulta = await consultarInfoEmpresa(intencion);
          break;
        case 'Legal':
          datosConsulta = await consultarInfoLegal(intencion);
          break;
        case 'Servicios':
          datosConsulta = await consultarServicios();
          break;
        case 'Precios':
          // Extraer el nombre del servicio del mensaje
          const servicio = extraerServicio(mensaje);
          if (servicio) {
            datosConsulta = await consultarPrecioServicio(servicio);
          }
          break;
        case 'Contacto':
          datosConsulta = await consultarContacto();
          break;
        default:
          // Consulta genérica para otras categorías
          if (intencion.campo_consulta && intencion.tabla_consulta) {
            datosConsulta = await consultaGenerica(
              intencion.tabla_consulta, 
              intencion.campo_consulta, 
              intencion.condicion
            );
          }
      }
    }
    
    // 2. Obtener una respuesta aleatoria de las disponibles
    // Ahora las respuestas están en el mismo registro, separadas por |||
    const respuesta = seleccionarRespuestaAleatoria(intencion.respuestas);
    
    // 3. Si hay datos de consulta y la respuesta es una plantilla, reemplazar variables
    let respuestaFinal = respuesta;
    if (datosConsulta && intencion.es_plantilla) {
      respuestaFinal = reemplazarVariables(respuesta, datosConsulta);
    }
    
    // 4. Devolver respuesta formateada
    return {
      respuesta: respuestaFinal,
      tipo: intencion.categoria,
      datos: datosConsulta
    };
    
  } catch (error) {
    logger.error(`Error al generar respuesta: ${error.message}`);
    throw error;
  }
}

/**
 * Selecciona una respuesta aleatoria de las disponibles
 */
function seleccionarRespuestaAleatoria(respuestasStr) {
  // Las respuestas están separadas por |||
  const respuestas = respuestasStr.split('|||');
  
  // Seleccionar una aleatoriamente
  const indice = Math.floor(Math.random() * respuestas.length);
  return respuestas[indice];
}

/**
 * Consulta información de contacto
 */
async function consultarContacto() {
  try {
    const query = "SELECT * FROM inf_perfil_empresa LIMIT 1";
    const resultado = await executeQuery(query);
    
    if (resultado.length === 0) {
      return { error: "No se encontró información de contacto" };
    }
    
    return resultado[0];
    
  } catch (error) {
    logger.error(`Error al consultar información de contacto: ${error.message}`);
    return { error: "No pudimos obtener la información de contacto" };
  }
}

/**
 * Consulta los horarios disponibles
 */
async function consultarHorarios() {
  try {
    const query = `
      SELECT h.*, e.nombre as nombre_empleado 
      FROM horarios h
      LEFT JOIN empleados e ON h.empleado_id = e.id
      ORDER BY dia_semana, hora_inicio
    `;
    
    const horarios = await executeQuery(query);
    
    // Procesar horarios para formato más amigable
    const horariosPorDia = {};
    
    horarios.forEach(h => {
      if (!horariosPorDia[h.dia_semana]) {
        horariosPorDia[h.dia_semana] = [];
      }
      
      // Formatear hora para mostrar
      const horaInicio = h.hora_inicio.substring(0, 5);
      const horaFin = h.hora_fin.substring(0, 5);
      
      horariosPorDia[h.dia_semana].push({
        empleado: h.nombre_empleado,
        horario: `${horaInicio} - ${horaFin}`,
        duracion: h.duracion
      });
    });
    
    return {
      horarios: formatearHorarios(horariosPorDia)
    };
    
  } catch (error) {
    logger.error(`Error al consultar horarios: ${error.message}`);
    return { error: "No pudimos obtener los horarios en este momento" };
  }
}

/**
 * Formatea los horarios para mostrarlos de manera amigable
 */
function formatearHorarios(horariosPorDia) {
  let resultado = "";
  
  for (const dia in horariosPorDia) {
    resultado += `${dia}: `;
    
    const horarios = horariosPorDia[dia].map(h => h.horario);
    const horariosUnicos = [...new Set(horarios)];
    
    resultado += horariosUnicos.join(", ");
    resultado += ". ";
  }
  
  return resultado;
}

/**
 * Consulta información sobre la empresa
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
        ORDER BY fecha_actualizacion DESC LIMIT 1
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
      return { error: "No se encontró información disponible" };
    }
    
    return resultados[0];
    
  } catch (error) {
    logger.error(`Error al consultar info de empresa: ${error.message}`);
    return { error: "No pudimos obtener la información de la empresa" };
  }
}

/**
 * Consulta información legal (términos, deslinde, etc.)
 */
async function consultarInfoLegal(intencion) {
  try {
    const tabla = intencion.tabla_consulta;
    
    // Validar el nombre de la tabla para evitar SQL injection
    if (!["inf_deslinde", "inf_terminos_condiciones", "inf_politicas_privacidad"].includes(tabla)) {
      return { error: "Tabla no válida" };
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
    if (documento.contenido && documento.contenido.length > 300) {
      documento.contenido_resumido = documento.contenido.substring(0, 300) + "... [Contenido recortado]";
      documento.contenido = documento.contenido_resumido;
    }
    
    return documento;
    
  } catch (error) {
    logger.error(`Error al consultar info legal: ${error.message}`);
    return { error: "No pudimos obtener la información legal solicitada" };
  }
}

/**
 * Consulta redes sociales
 */
async function consultarRedesSociales() {
  try {
    const query = "SELECT * FROM inf_redes_sociales";
    const redes = await executeQuery(query);
    
    if (redes.length === 0) {
      return { redes: "No hay redes sociales registradas actualmente." };
    }
    
    // Formatear las redes para mostrarlas
    const redesFormateadas = redes.map(red => `${red.nombre_red}: ${red.url}`).join(", ");
    
    return { 
      redes: redesFormateadas,
      redes_lista: redes
    };
    
  } catch (error) {
    logger.error(`Error al consultar redes sociales: ${error.message}`);
    return { error: "No pudimos obtener la información de redes sociales" };
  }
}

/**
 * Consulta servicios disponibles
 */
async function consultarServicios() {
  try {
    const query = `
      SELECT id, title, description, category, price, duration, image_url
      FROM servicios
      ORDER BY category, title
    `;
    
    const servicios = await executeQuery(query);
    
    if (servicios.length === 0) {
      return { 
        servicios: "No hay servicios registrados actualmente." 
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
        precio: s.price,
        duracion: s.duration,
        descripcion: s.description
      });
    });
    
    // Formatear para mostrar
    let listaServicios = "";
    
    for (const categoria in serviciosPorCategoria) {
      const serviciosTexto = serviciosPorCategoria[categoria]
        .map(s => `${s.nombre} ($${s.precio})`)
        .join(", ");
      
      listaServicios += `Categoría ${categoria}: ${serviciosTexto}. `;
    }
    
    return { 
      servicios: listaServicios,
      serviciosPorCategoria: serviciosPorCategoria
    };
    
  } catch (error) {
    logger.error(`Error al consultar servicios: ${error.message}`);
    return { error: "No pudimos obtener la información de servicios" };
  }
}

/**
 * Consulta el precio de un servicio específico
 */
async function consultarPrecioServicio(nombreServicio) {
  try {
    const query = `
      SELECT id, title, description, price, duration, category, image_url
      FROM servicios
      WHERE title LIKE ?
      LIMIT 1
    `;
    
    const servicios = await executeQuery(query, [`%${nombreServicio}%`]);
    
    if (servicios.length === 0) {
      // Si no encuentra el servicio, devolver servicios similares
      const querySimilares = `
        SELECT title FROM servicios
        ORDER BY title
        LIMIT 5
      `;
      
      const similares = await executeQuery(querySimilares);
      const sugerencias = similares.map(s => s.title).join(", ");
      
      return { 
        error: `No encontramos el servicio "${nombreServicio}"`,
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
    
    return {
      servicio: servicio.title,
      precio: servicio.price,
      duracion: servicio.duration,
      categoria: servicio.category,
      descripcion: servicio.description,
      detalles: detalles
    };
    
  } catch (error) {
    logger.error(`Error al consultar precio: ${error.message}`);
    return { error: "No pudimos obtener el precio del servicio solicitado" };
  }
}

/**
 * Consulta genérica para cualquier tabla
 */
async function consultaGenerica(tabla, campo, condicion) {
  try {
    // Lista de tablas permitidas para consulta
    const tablasPermitidas = [
      'acerca_de', 'chatbot', 'horarios', 'inf_deslinde', 
      'inf_perfil_empresa', 'inf_politicas_privacidad', 
      'inf_redes_sociales', 'inf_terminos_condiciones',
      'preguntas_frecuentes', 'servicios', 'servicio_detalles'
    ];
    
    // Validar tabla para evitar SQL injection
    if (!tablasPermitidas.includes(tabla)) {
      return { error: "Tabla no permitida" };
    }
    
    // Construir la consulta base
    let query = `SELECT ${campo === '*' ? '*' : campo} FROM ${tabla}`;
    
    // Agregar condición si existe
    if (condicion) {
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
 * Extrae el nombre del servicio del mensaje del usuario
 */
function extraerServicio(mensaje) {
  if (!mensaje) return null;
  
  // Lista de servicios comunes para buscar
  const serviciosComunes = [
    'limpieza dental', 'blanqueamiento', 'ortodoncia', 'brackets',
    'implante', 'endodoncia', 'extracción', 'consulta', 'valoración',
    'carilla', 'corona', 'empaste', 'resina', 'prótesis', 'puente',
    'invisalign', 'muelas del juicio'
  ];
  
  // Buscar coincidencias
  for (const servicio of serviciosComunes) {
    if (mensaje.includes(servicio)) {
      return servicio;
    }
  }
  
  // Si no hay coincidencia exacta, buscar palabras clave
  const palabrasClave = [
    'limpieza', 'blanquea', 'ortodoncia', 'bracket', 'frenos',
    'implante', 'endodoncia', 'extrac', 'muela', 'diente',
    'consulta', 'revision', 'carilla', 'corona', 'empaste', 'resina',
    'protesis', 'puente', 'juicio', 'invisalign'
  ];
  
  for (const palabra of palabrasClave) {
    if (mensaje.includes(palabra)) {
      return palabra;
    }
  }
  
  return null;
}

/**
 * Reemplaza variables de plantilla con datos reales
 */
function reemplazarVariables(plantilla, datos) {
  // Si no hay datos, devolver la plantilla original
  if (!datos) return plantilla;
  
  let resultado = plantilla;
  
  // Reemplazar variables específicas
  if (datos.horarios) {
    resultado = resultado.replace(/\{\{horarios\}\}/g, datos.horarios);
  }
  
  if (datos.redes) {
    resultado = resultado.replace(/\{\{redes\}\}/g, datos.redes);
  }
  
  if (datos.servicios) {
    resultado = resultado.replace(/\{\{servicios\}\}/g, datos.servicios);
  }
  
  if (datos.servicio && datos.precio) {
    resultado = resultado
      .replace(/\{\{servicio\}\}/g, datos.servicio)
      .replace(/\{\{precio\}\}/g, datos.precio);
      
    if (datos.duracion) {
      resultado = resultado.replace(/\{\{duracion\}\}/g, datos.duracion);
    }
  }
  
  if (datos.contenido) {
    resultado = resultado.replace(/\{\{contenido\}\}/g, datos.contenido);
  }
  
  if (datos.descripcion) {
    resultado = resultado.replace(/\{\{descripcion\}\}/g, datos.descripcion);
  }
  
  // Reemplazar datos de perfil empresa
  const camposPerfil = [
    'calle_numero', 'localidad', 'municipio', 'estado', 'codigo_postal',
    'telefono_principal', 'correo_electronico', 'sitio_web'
  ];
  
  for (const campo of camposPerfil) {
    if (datos[campo]) {
      const regex = new RegExp(`\\{\\{${campo}\\}\\}`, 'g');
      resultado = resultado.replace(regex, datos[campo]);
    }
  }
  
  if (datos.error) {
    resultado = `Lo siento, ${datos.error}`;
    
    if (datos.sugerencias) {
      resultado += `. Estos son algunos servicios disponibles: ${datos.sugerencias}`;
    }
  }
  
  return resultado;
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
      LIMIT 10
    `;
    
    const preguntas = await executeQuery(query);
    
    return res.json({ preguntas });
    
  } catch (error) {
    logger.error(`Error al obtener preguntas frecuentes: ${error.message}`);
    return res.status(500).json({ error: "Error al obtener preguntas frecuentes" });
  }
});

/**
 * Endpoint para obtener patrones del chatbot (útil para administración)
 */
router.get("/patrones", async (req, res) => {
  try {
    const query = `
      SELECT id, patron, categoria, prioridad 
      FROM chatbot
      ORDER BY categoria, prioridad DESC
    `;
    
    const patrones = await executeQuery(query);
    
    return res.json({ patrones });
    
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
    const datos = await consultarServicios();
    return res.json(datos);
    
  } catch (error) {
    logger.error(`Error al obtener servicios: ${error.message}`);
    return res.status(500).json({ error: "Error al obtener servicios" });
  }
});

/**
 * Endpoint para obtener precio de un servicio
 */
router.get("/precio-servicio", async (req, res) => {
  try {
    const { nombre } = req.query;
    
    if (!nombre) {
      return res.status(400).json({ error: "Debe especificar el nombre del servicio" });
    }
    
    const datos = await consultarPrecioServicio(nombre);
    return res.json(datos);
    
  } catch (error) {
    logger.error(`Error al obtener precio: ${error.message}`);
    return res.status(500).json({ error: "Error al obtener el precio del servicio" });
  }
});

/**
 * Endpoint para obtener horarios
 */
router.get("/horarios", async (req, res) => {
  try {
    const datos = await consultarHorarios();
    return res.json(datos);
    
  } catch (error) {
    logger.error(`Error al obtener horarios: ${error.message}`);
    return res.status(500).json({ error: "Error al obtener horarios" });
  }
});

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
    
    return res.json(resultado[0]);
    
  } catch (error) {
    logger.error(`Error al obtener perfil de empresa: ${error.message}`);
    return res.status(500).json({ error: "Error al obtener perfil de empresa" });
  }
});

/**
 * Endpoint para obtener acerca de (historia, misión, etc.)
 */
router.get("/acerca-de/:tipo", async (req, res) => {
  try {
    const { tipo } = req.params;
    
    // Validar el tipo
    const tiposPermitidos = ['Historia', 'Misión', 'Visión', 'Valores'];
    
    if (!tiposPermitidos.includes(tipo)) {
      return res.status(400).json({ error: "Tipo no válido" });
    }
    
    const query = "SELECT * FROM acerca_de WHERE tipo = ? ORDER BY fecha_actualizacion DESC LIMIT 1";
    const resultado = await executeQuery(query, [tipo]);
    
    if (resultado.length === 0) {
      return res.status(404).json({ error: `No se encontró información sobre ${tipo}` });
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
    switch (tipo) {
      case 'deslinde':
        tabla = 'inf_deslinde';
        break;
      case 'terminos':
        tabla = 'inf_terminos_condiciones';
        break;
      case 'privacidad':
        tabla = 'inf_politicas_privacidad';
        break;
      default:
        return res.status(400).json({ error: "Tipo no válido" });
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
    timestamp: new Date()
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
      prioridad
    } = req.body;
    
    // Validar datos obligatorios
    if (!patron || !categoria || !respuestas) {
      return res.status(400).json({ error: "Faltan datos obligatorios (patron, categoria, respuestas)" });
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
        prioridad = ?
        WHERE id = ?
      `;
      
      await executeQuery(
        query, 
        [
          patron, 
          categoria, 
          respuestas, 
          es_plantilla || 0, 
          tabla_consulta, 
          campo_consulta, 
          condicion, 
          prioridad || 5,
          id
        ]
      );
      
      return res.json({ mensaje: "Patrón actualizado correctamente", id });
      
    } else {
      const query = `
        INSERT INTO chatbot
        (patron, categoria, respuestas, es_plantilla, tabla_consulta, campo_consulta, condicion, prioridad)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const result = await executeQuery(
        query, 
        [
          patron, 
          categoria, 
          respuestas, 
          es_plantilla || 0, 
          tabla_consulta, 
          campo_consulta, 
          condicion, 
          prioridad || 5
        ]
      );
      
      return res.json({ 
        mensaje: "Patrón agregado correctamente", 
        id: result.insertId 
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
    
    const query = "DELETE FROM chatbot WHERE id = ?";
    const result = await executeQuery(query, [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Patrón no encontrado" });
    }
    
    return res.json({ mensaje: "Patrón eliminado correctamente" });
    
  } catch (error) {
    logger.error(`Error al eliminar patrón: ${error.message}`);
    return res.status(500).json({ error: "Error al eliminar patrón" });
  }
});

module.exports = router;