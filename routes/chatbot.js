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

// Procesa el mensaje del usuario y genera una respuesta apropiada
async function procesarMensaje(mensaje, contexto = {}) {
  try {
    // Aplicar correcciones ortográficas básicas
    const mensajeCorregido = corregirErroresOrtograficos(mensaje);
    
    // Normalizar el mensaje (minúsculas, quitar caracteres especiales, etc.)
    const mensajeNormalizado = normalizarTexto(mensajeCorregido);
    
    // 1. Extraer entidades/servicios específicos del mensaje
    const entidades = extraerEntidades(mensajeNormalizado);
    entidades.tratamientos = await extraerTratamientos(mensajeNormalizado);
    
    // Verificar consulta sobre día específico para horarios
    if (entidades.horarios && entidades.dia_especifico) {
      const horarioDia = await consultarHorarioPorDia(entidades.dia_especifico);
      
      if (!horarioDia.error) {
        return {
          respuesta: `Para el día ${entidades.dia_especifico}: ${horarioDia.texto_horarios}`,
          tipo: "Horario",
          subtipo: "dia_especifico",
          datos: horarioDia,
          entidades
        };
      } else {
        return {
          respuesta: horarioDia.error,
          tipo: "Horario",
          subtipo: "dia_no_disponible",
          datos: horarioDia,
          entidades
        };
      }
    }
    
    // Caso especial para fin de semana
    if (entidades.dia_especifico === 'fin_semana') {
      const horarioSabado = await consultarHorarioPorDia('Sábado');
      const horarioDomingo = await consultarHorarioPorDia('Domingo');
      
      let respuestaFinSemana = "Horarios de fin de semana: ";
      
      if (!horarioSabado.error) {
        respuestaFinSemana += `Sábado: ${horarioSabado.texto_horarios}. `;
      } else {
        respuestaFinSemana += "No atendemos los sábados. ";
      }
      
      if (!horarioDomingo.error) {
        respuestaFinSemana += `Domingo: ${horarioDomingo.texto_horarios}.`;
      } else {
        respuestaFinSemana += "No atendemos los domingos.";
      }
      
      return {
        respuesta: respuestaFinSemana,
        tipo: "Horario",
        subtipo: "fin_semana",
        datos: { sabado: horarioSabado, domingo: horarioDomingo },
        entidades
      };
    }
    
    // 2. Verificar si es una consulta de citas existentes
    if (entidades.citas && (contexto.esperandoIdentificador === true || contexto.procesandoCita === true)) {
      // Verificar si estamos esperando un identificador (correo o teléfono)
      if (contexto.esperandoIdentificador === true) {
        // Detectar si el mensaje parece un correo o teléfono
        const posibleCorreo = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/.test(mensaje);
        const posibleTelefono = /\b\d{8,12}\b/.test(mensaje.replace(/[\s-]/g, ''));
        
        if (posibleCorreo || posibleTelefono) {
          const identificador = posibleCorreo 
            ? mensaje.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/)[0]
            : mensaje.replace(/[\s-]/g, '').match(/\b\d{8,12}\b/)[0];
          
          const infoCitas = await consultarCitasPaciente(identificador);
          return {
            respuesta: infoCitas.error 
              ? `${infoCitas.error}. ${infoCitas.mensaje || ''}`
              : `${infoCitas.mensaje} ${infoCitas.citas.map(c => `${c.servicio} - ${c.fecha} a las ${c.hora}`).join(', ')}. ${infoCitas.recordatorio || ''}`,
            tipo: "Citas",
            subtipo: "consulta_resultado",
            datos: infoCitas,
            entidades,
            contexto: { procesandoCita: false, esperandoIdentificador: false }
          };
        } else {
          return {
            respuesta: "No he podido reconocer un correo electrónico o número telefónico válido. Por favor, proporciona tu correo electrónico o número telefónico exactamente como lo registraste.",
            tipo: "Citas",
            subtipo: "solicitud_identificador",
            datos: null,
            entidades,
            contexto: { esperandoIdentificador: true }
          };
        }
      }
      
      // Si solo está preguntando sobre citas, pero aún no ha proporcionado identificador
      if (mensajeNormalizado.includes("mi cita") || mensajeNormalizado.includes("mis citas") || mensajeNormalizado.includes("tengo cita")) {
        return {
          respuesta: "Para consultar tus citas, necesito que me proporciones tu correo electrónico o número telefónico con el que te registraste.",
          tipo: "Citas",
          subtipo: "solicitud_identificador",
          datos: null,
          entidades,
          contexto: { esperandoIdentificador: true }
        };
      }
    }
    
    // Consultas sobre precios de tratamientos específicos
    if (entidades.tratamientos.length > 0 && entidades.pago) {
      const tratamiento = entidades.tratamientos[0];
      const datoTratamiento = await consultarTratamiento(tratamiento);
      
      if (datoTratamiento && !datoTratamiento.error) {
        return {
          respuesta: `El precio del tratamiento de ${datoTratamiento.nombre} es de $${datoTratamiento.precio} MXN.`,
          tipo: "Precios",
          subtipo: "precio_especifico",
          datos: datoTratamiento,
          entidades
        };
      }
    }
    
    // Consultas sobre detalles de tratamientos específicos
    if (entidades.tratamientos.length > 0 && !entidades.pago && !entidades.horarios) {
      const tratamiento = entidades.tratamientos[0];
      const datoTratamiento = await consultarTratamiento(tratamiento);
      
      if (datoTratamiento && !datoTratamiento.error) {
        let respuesta = `Ofrecemos el servicio de ${datoTratamiento.nombre}.`;
        
        if (datoTratamiento.descripcion) {
          respuesta += ` ${datoTratamiento.descripcion}`;
        }
        
        // Añadir información sobre duración si está disponible
        if (datoTratamiento.duracion) {
          respuesta += ` El procedimiento toma aproximadamente ${datoTratamiento.duracion}.`;
        }
        
        return {
          respuesta: respuesta,
          tipo: "Servicios",
          subtipo: "servicio_especifico",
          datos: datoTratamiento,
          entidades
        };
      }
    }
    
    // 3. Buscar intenciones que coincidan con el mensaje
    const intencion = await buscarIntencionMejorada(mensajeNormalizado);
    
    // 4. Manejar casos específicos si no encontramos una intención clara
    if (!intencion) {
      // Verificar si es una consulta sobre servicios específicos
      if (entidades.tratamientos && entidades.tratamientos.length > 0) {
        const tratamiento = entidades.tratamientos[0];
        const datoTratamiento = await consultarTratamiento(tratamiento);
        
        if (datoTratamiento && !datoTratamiento.error) {
          let respuesta = `Ofrecemos el servicio de ${datoTratamiento.nombre || tratamiento}.`;
          
          if (datoTratamiento.precio) {
            respuesta += ` El precio es $${datoTratamiento.precio} MXN.`;
          }
          
          if (datoTratamiento.duracion) {
            respuesta += ` La duración aproximada es ${datoTratamiento.duracion}.`;
          }
          
          if (datoTratamiento.descripcion) {
            respuesta += ` ${datoTratamiento.descripcion}`;
          }
          
          // Verificar si es un tratamiento o un servicio normal
          const esTratamiento = datoTratamiento.categoria === 'Periodoncia' || 
                              datoTratamiento.categoria === 'Ortodoncia' || 
                              datoTratamiento.categoria === 'Cirugía';
          
          if (esTratamiento) {
            respuesta += " Este es un tratamiento que requiere múltiples citas y un plan personalizado.";
          }
          
          return {
            respuesta: respuesta,
            tipo: "Servicios",
            subtipo: esTratamiento ? "tratamiento_especifico" : "servicio_especifico",
            datos: datoTratamiento,
            entidades
          };
        }
      }
      
      // Verificar si es una consulta sobre el perfil de la empresa
      if (entidades.empresa) {
        const perfilEmpresa = await consultarPerfilEmpresa();
        
        if (perfilEmpresa && !perfilEmpresa.error) {
          return {
            respuesta: `Somos ${perfilEmpresa.nombre_pagina || 'una clínica dental especializada'}. ${perfilEmpresa.descripcion || 'Ofrecemos servicios dentales de alta calidad para toda la familia.'}`,
            tipo: "Empresa",
            subtipo: "perfil",
            datos: perfilEmpresa,
            entidades
          };
        }
      }
      
      // Verificar si es una consulta sobre horarios
      if (entidades.horarios) {
        const horarios = await consultarHorarios();
        
        if (horarios && !horarios.error) {
          return {
            respuesta: `Nuestros horarios de atención son: ${horarios.horarios || 'Lunes a Viernes de 9:00 a 18:00 horas.'}`,
            tipo: "Horario",
            subtipo: "general",
            datos: horarios,
            entidades
          };
        }
      }
      
      // Si es una consulta general sobre servicios
      if (mensajeNormalizado.includes("servicio") || mensajeNormalizado.includes("tratamiento")) {
        const datosTratamientos = await consultarTratamientos();
        
        if (datosTratamientos && !datosTratamientos.error) {
          return {
            respuesta: `Ofrecemos los siguientes servicios dentales: ${datosTratamientos.servicios}. ¿Deseas información sobre alguno en particular?`,
            tipo: "Servicios",
            subtipo: "listado_general",
            datos: datosTratamientos,
            entidades
          };
        }
      }

      // Buscar en preguntas frecuentes si no hay una intención clara
      const preguntaFrecuente = await buscarPreguntaFrecuente(mensajeNormalizado);
      if (preguntaFrecuente) {
        return {
          respuesta: preguntaFrecuente.respuesta,
          tipo: "PreguntaFrecuente",
          subtipo: "pregunta_respuesta",
          datos: preguntaFrecuente,
          entidades
        };
      }
      
      // Respuesta por defecto si no se encuentra ninguna intención específica
      return {
        respuesta: "Lo siento, no entendí tu petición. ¿Podrías ser más específico o preguntar de otra manera? Puedo ayudarte con información sobre nuestros servicios, horarios o verificar tus citas existentes.",
        tipo: "default",
        datos: null,
        entidades
      };
    }
    
    // 5. Generar respuesta según la intención, considerando las entidades encontradas
    return await generarRespuesta(intencion, mensajeNormalizado, entidades, contexto);
    
  } catch (error) {
    logger.error(`Error al procesar mensaje: ${error.stack}`);
    throw error;
  }
}

// Aplica correcciones ortográficas básicas
function corregirErroresOrtograficos(texto) {
  // Diccionario básico de correcciones comunes
  const correcciones = {
    'orario': 'horario',
    'ora': 'hora',
    'sabados': 'sábados',
    'savado': 'sábado',
    'sabado': 'sábado',
    'domingo': 'domingo',
    'kiero': 'quiero',
    'ke': 'que',
    'k': 'que',
    'xq': 'porque',
    'pq': 'porque',
    'info': 'información',
    'asegurar': 'agendar',
    'tmbn': 'también',
    'x': 'por',
    'q': 'que',
    'atiención': 'atención',
    'attención': 'atención',
    'preccion': 'precio',
    'presio': 'precio',
    'cta': 'cita',
    'tel': 'teléfono',
    'telefno': 'teléfono',
    'telefno': 'teléfono',
    'nescito': 'necesito',
    'nesecito': 'necesito',
    'voi': 'voy',
    'boy': 'voy',
    'sacar': 'agendar',
    'limpiesa': 'limpieza',
    'atienden': 'atienden',
    'abren': 'abren',
    'horarios': 'horarios',
    'estan': 'están',
    'implntes': 'implantes',
    'inplantes': 'implantes',
    'ase': 'hace',
    'endodonsia': 'endodoncia',
    'cuestan': 'cuestan',
    'kuesta': 'cuesta',
    'servizio': 'servicio',
    'urgente': 'urgente',
    'muela': 'muela',
    'dolor': 'dolor',
    'gracias': 'gracias',
    'mersii': 'gracias',
    'adios': 'adiós',
    'chao': 'adiós',
    'bracket': 'brackets',
    'brakets': 'brackets',
    'doktor': 'doctor',
    'dr': 'doctor',
    'sirugia': 'cirugía',
    'cirugia': 'cirugía'
  };
  
  // Tokenizar el texto y corregir palabras
  return texto
    .split(' ')
    .map(palabra => {
      const palabraLower = palabra.toLowerCase().trim();
      return correcciones[palabraLower] || palabra;
    })
    .join(' ');
}

// Busca una pregunta frecuente que coincida con el mensaje
async function buscarPreguntaFrecuente(mensaje) {
  try {
    // Ampliar la búsqueda con sinónimos
    const tokensBase = mensaje.split(/\s+/).filter(t => t.length > 3);
    const tokensConSinonimos = [];
    
    // Agregar los tokens originales
    tokensBase.forEach(token => {
      tokensConSinonimos.push(token);
      // Agregar sinónimos si existen
      const sinonimos = expandirSinonimos(token);
      sinonimos.forEach(sinonimo => {
        if (!tokensConSinonimos.includes(sinonimo)) {
          tokensConSinonimos.push(sinonimo);
        }
      });
    });
    
    // Construir condición dinámica para la consulta
    let condicionLike = tokensConSinonimos.map(token => 
      `pregunta LIKE '%${token}%'`
    ).join(' OR ');
    
    // Consulta para buscar preguntas similares
    const query = `
      SELECT id, pregunta, respuesta,
             (
               CASE
                 WHEN pregunta = ? THEN 100
                 WHEN pregunta LIKE ? THEN 80
                 WHEN ? LIKE CONCAT('%', pregunta, '%') THEN 70
                 ELSE (
                   SELECT COUNT(*) * 10 
                   FROM (
                     SELECT unnest(ARRAY[${tokensConSinonimos.map(() => '?').join(', ')}]) AS token
                   ) AS tokens
                   WHERE pregunta LIKE CONCAT('%', token, '%')
                 )
               END
             ) AS relevancia
      FROM preguntas_frecuentes
      WHERE 
        estado = 'registrado' AND
        (
          pregunta = ? OR
          pregunta LIKE ? OR
          ? LIKE CONCAT('%', pregunta, '%') OR
          ${condicionLike}
        )
      HAVING relevancia > 20
      ORDER BY relevancia DESC, LENGTH(pregunta) DESC
      LIMIT 1
    `;
    
    // Preparar parámetros para la consulta
    const params = [
      mensaje, `%${mensaje}%`, mensaje,
      ...tokensConSinonimos,
      mensaje, `%${mensaje}%`, mensaje
    ];
    
    const resultados = await executeQuery(query, params);
    
    if (resultados.length > 0) {
      return resultados[0];
    }
    
    return null;
  } catch (error) {
    logger.error(`Error al buscar pregunta frecuente: ${error.message}`);
    return null;
  }
}

// Implementa un sistema de sinónimos para mejorar la comprensión
function expandirSinonimos(palabra) {
  const diccionarioSinonimos = {
    'doctor': ['dentista', 'odontólogo', 'especialista', 'médico', 'profesional'],
    'tratamiento': ['procedimiento', 'servicio', 'atención', 'intervención'],
    'precio': ['costo', 'valor', 'tarifa', 'cuánto cuesta', 'cuánto vale'],
    'horario': ['hora', 'horarios', 'horas', 'cuando atienden', 'cuando abren'],
    'cita': ['consulta', 'turno', 'reservación', 'agenda', 'programación'],
    'ubicación': ['dirección', 'donde están', 'dónde quedan', 'cómo llegar'],
    'emergencia': ['urgencia', 'urgente', 'dolor', 'accidente'],
    'limpieza': ['profilaxis', 'higiene', 'limpieza dental'],
    'brackets': ['ortodoncia', 'frenos', 'aparatos'],
    'endodoncia': ['tratamiento de conducto', 'nervio', 'conducto'],
    'extracción': ['sacar muela', 'quitar diente', 'extracción dental'],
    'implante': ['implantes dentales', 'prótesis fija', 'diente artificial'],
    'corona': ['funda', 'corona dental'],
    'prótesis': ['dentadura', 'puente', 'dientes postizos']
  };
  
  return diccionarioSinonimos[palabra.toLowerCase()] || [palabra];
}

// Normaliza el texto del mensaje para facilitar el procesamiento
function normalizarTexto(texto) {
  if (!texto) return "";
  
  try {
    return texto.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Eliminar acentos
      .replace(/[^\w\s]/gi, " ")       // Reemplazar caracteres especiales por espacios
      .replace(/\s+/g, " ")            // Eliminar espacios múltiples
      .trim();
  } catch (error) {
    logger.error(`Error al normalizar texto: ${error.message}`);
    return String(texto).toLowerCase().trim();
  }
}

// Extrae entidades relevantes del mensaje del usuario
function extraerEntidades(mensaje) {
  const entidades = {
    tratamientos: [],
    horarios: false,
    dia_especifico: null,
    ubicacion: false,
    contacto: false,
    citas: false,
    educativo: false,
    postTratamiento: false,
    pago: false,
    redes: false,
    legal: false,
    empresa: false
  };
  
  // Palabras clave para detectar intención sobre horarios
  const palabrasHorario = ['horario', 'hora', 'abierto', 'disponible', 'atienden', 'cuando', 'cuándo', 'dias', 'días', 'abren', 'cierran'];
  entidades.horarios = palabrasHorario.some(palabra => mensaje.includes(palabra));
  
  // Detectar días específicos
  const diasSemana = {
    'lunes': 'Lunes',
    'martes': 'Martes',
    'miercoles': 'Miércoles',
    'miércoles': 'Miércoles',
    'jueves': 'Jueves',
    'viernes': 'Viernes',
    'sabado': 'Sábado',
    'sábado': 'Sábado',
    'domingo': 'Domingo',
    'fin de semana': 'fin_semana',
    'fines de semana': 'fin_semana',
    'sabados y domingos': 'fin_semana',
    'sábados y domingos': 'fin_semana'
  };
  
  // Buscar días específicos en el mensaje
  for (const [dia, formato] of Object.entries(diasSemana)) {
    if (mensaje.includes(dia)) {
      entidades.dia_especifico = formato;
      break;
    }
  }
  
  // Buscar días por abreviatura (lun, mar, mie, jue, vie)
  const abreviaturas = {
    'lun': 'Lunes',
    'mar': 'Martes',
    'mie': 'Miércoles',
    'jue': 'Jueves',
    'vie': 'Viernes',
    'sab': 'Sábado',
    'dom': 'Domingo',
  };
  
  // Si no se encontró por nombre completo, buscar por abreviatura
  if (!entidades.dia_especifico) {
    for (const [abrev, formato] of Object.entries(abreviaturas)) {
      if (mensaje.includes(` ${abrev} `)) {
        entidades.dia_especifico = formato;
        break;
      }
    }
  }
  
  // Palabras clave para detectar intención sobre ubicación
  const palabrasUbicacion = ['donde', 'dónde', 'ubicacion', 'ubicación', 'dirección', 'direccion', 'llegar', 'encuentran', 'como llegar', 'calle', 'avenida', 'boulevard', 'blvd', 'colonia', 'domicilio', 'mapa'];
  entidades.ubicacion = palabrasUbicacion.some(palabra => mensaje.includes(palabra));
  
  // Palabras clave para detectar intención sobre contacto
  const palabrasContacto = ['contacto', 'telefono', 'teléfono', 'llamar', 'email', 'correo', 'whatsapp', 'contactar', 'celular', 'comunico', 'comunicarme', 'comunicar', 'número', 'numero'];
  entidades.contacto = palabrasContacto.some(palabra => mensaje.includes(palabra));
  
  // Palabras clave para detectar intención sobre citas
  const palabrasCitas = ['cita', 'agendar', 'programar', 'consulta', 'reservar', 'visita', 'acudir', 'turno', 'agenda', 'sacar cita', 'hacer cita', 'solicitar cita', 'consultar cita', 'mi cita', 'tengo cita'];
  entidades.citas = palabrasCitas.some(palabra => mensaje.includes(palabra));
  
  // Palabras clave para detectar intención sobre información educativa
  const palabrasEducativo = ['consejo', 'consejos', 'recomendacion', 'recomendación', 'alimentacion', 'alimentación', 'prevencion', 'prevención', 'cuidado', 'mitos', 'cepillado', 'hilo dental', 'enjuague'];
  entidades.educativo = palabrasEducativo.some(palabra => mensaje.includes(palabra));
  
  // Palabras clave para detectar intención sobre post-tratamiento
  const palabrasPostTratamiento = ['despues', 'después', 'posterior', 'recuperacion', 'recuperación', 'sangrado', 'hinchazón', 'dolor', 'inflamación', 'inflamacion', 'cuidados', 'recomendaciones post'];
  entidades.postTratamiento = palabrasPostTratamiento.some(palabra => mensaje.includes(palabra));
  
  // Palabras clave para detectar intención sobre pagos
  const palabrasPago = ['pago', 'precio', 'costo', 'tarjeta', 'efectivo', 'transferencia', 'valor', 'cuanto cuesta', 'cuánto cuesta', 'cuánto vale', 'cuanto vale', 'tarifa', 'promoción', 'promocion', 'descuento', 'cobran', '$', 'pesos', 'mxn'];
  entidades.pago = palabrasPago.some(palabra => mensaje.includes(palabra));
  
  // Palabras clave para detectar intención sobre redes sociales
  const palabrasRedes = ['redes', 'facebook', 'instagram', 'twitter', 'tiktok', 'youtube', 'siguenos', 'social', 'página', 'pagina', 'fanpage', 'perfil', 'síguenos', 'siguenos'];
  entidades.redes = palabrasRedes.some(palabra => mensaje.includes(palabra));
  
  // Palabras clave para detectar intención sobre información legal
  const palabrasLegal = ['legal', 'politica', 'política', 'privacidad', 'terminos', 'términos', 'condiciones', 'deslinde', 'responsabilidad', 'derechos', 'obligaciones', 'aviso legal'];
  entidades.legal = palabrasLegal.some(palabra => mensaje.includes(palabra));
  
  // Palabras clave para detectar intención sobre información de la empresa
  const palabrasEmpresa = ['empresa', 'clinica', 'clínica', 'historia', 'mision', 'misión', 'vision', 'visión', 'valores', 'quienes son', 'acerca', 'servicios', 'equipo', 'doctor', 'doctores', 'especialistas', 'odontólogos', 'odontologos', 'dentistas'];
  entidades.empresa = palabrasEmpresa.some(palabra => mensaje.includes(palabra));
  
  return entidades;
}

// Extrae nombres de tratamientos dentales del mensaje
async function extraerTratamientos(mensaje) {
  try {
    // Palabras comunes en mensajes que no son nombres de tratamientos
    const palabrasComunes = ['hola', 'necesito', 'quiero', 'quisiera', 'informacion', 'información', 'sobre', 'para', 'tengo', 'hay', 'hacer', 'costo', 'precio', 'necesitaría', 'necesitaria', 'ofrecen', 'tienen', 'realizan', 'servicio', 'tratamiento', 'pueden'];
    
    // Primero, obtenemos todos los servicios de la base de datos
    const query = `
      SELECT id, title, LOWER(title) as title_lower, description, category 
      FROM servicios
      ORDER BY title
    `;
    
    const servicios = await executeQuery(query);
    
    if (servicios.length === 0) {
      return [];
    }
    
    // Crear un catálogo dinámico con los servicios de la base de datos
    const catalogoTratamientos = [];
    
    for (const servicio of servicios) {
      // Generar alternativas desde el título y descripción
      const palabrasClaveTitle = servicio.title_lower.split(/\s+/)
        .filter(p => p.length > 3 && !palabrasComunes.includes(p));
        
      const palabrasClaveDesc = servicio.description 
        ? servicio.description.toLowerCase().split(/\s+/)
            .filter(p => p.length > 3 && !palabrasComunes.includes(p))
        : [];
      
      // Unir alternativas y eliminar duplicados
      const alternativas = [...new Set([...palabrasClaveTitle, ...palabrasClaveDesc])];
      
      // Agregar sinónimos específicos del sector dental
      let sinonimos = [];
      alternativas.forEach(alt => {
        const sinonimosPalabra = expandirSinonimos(alt);
        sinonimos = [...sinonimos, ...sinonimosPalabra];
      });
      
      catalogoTratamientos.push({
        id: servicio.id,
        nombre: servicio.title_lower,
        categoria: servicio.category,
        alternativas: [...new Set([...alternativas, ...sinonimos])].filter(a => a !== servicio.title_lower)
      });
    }
    
    const tratamientosEncontrados = [];
    
    // Buscar cada tratamiento y sus alternativas en el mensaje
    catalogoTratamientos.forEach(tratamiento => {
      if (mensaje.includes(tratamiento.nombre)) {
        tratamientosEncontrados.push(tratamiento.nombre);
      } else {
        const encontrado = tratamiento.alternativas.some(alternativa => 
          mensaje.includes(alternativa) && alternativa.length > 3
        );
        
        if (encontrado && !tratamientosEncontrados.includes(tratamiento.nombre)) {
          tratamientosEncontrados.push(tratamiento.nombre);
        }
      }
    });
    
    return tratamientosEncontrados;
  } catch (error) {
    logger.error(`Error al extraer tratamientos: ${error.message}`);
    // Catálogo de respaldo para detectar tratamientos básicos en caso de error
    const catalogoBasico = [
      {nombre: "limpieza dental", alternativas: ["limpieza", "profilaxis", "higiene"]},
      {nombre: "consulta general", alternativas: ["revision", "chequeo", "evaluacion"]},
      {nombre: "curetaje", alternativas: ["limpieza profunda", "raspado"]},
      {nombre: "diseño de sonrisa", alternativas: ["diseño", "sonrisa"]},
      {nombre: "cirugía de encía", alternativas: ["cirugia", "encia"]},
      {nombre: "obturación con resina", alternativas: ["obturacion", "resina", "empaste"]},
      {nombre: "incrustación", alternativas: ["incrustacion", "metal"]},
      {nombre: "coronas", alternativas: ["corona", "fija"]},
      {nombre: "placas removibles", alternativas: ["placa", "parcial", "removible"]},
      {nombre: "placas totales", alternativas: ["placa", "total"]},
      {nombre: "guardas dentales", alternativas: ["guarda", "protector"]},
      {nombre: "endodoncia", alternativas: ["tratamiento de conducto", "nervio", "conducto"]},
      {nombre: "extracción", alternativas: ["extraer", "sacar muela", "quitar diente"]},
      {nombre: "implantes", alternativas: ["implante", "implantes dentales", "diente artificial"]},
      {nombre: "ortodoncia", alternativas: ["brackets", "frenos", "aparatos"]},
      {nombre: "blanqueamiento", alternativas: ["blanquear", "dientes blancos", "aclarar dientes"]}
    ];
    
    const tratamientosEncontrados = [];
    
    // Buscar cada tratamiento básico y sus alternativas en el mensaje
    catalogoBasico.forEach(tratamiento => {
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
}

// Mejora la búsqueda de intención con un enfoque más estadístico
async function buscarIntencionMejorada(mensaje) {
  try {
    // Dividir el mensaje en tokens
    const tokens = mensaje.split(/\s+/).filter(t => t.length > 2);
    
    // 1. Búsqueda por coincidencia exacta
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
    
    // 2. Búsqueda estadística optimizada
    const queryPuntuacion = `
      SELECT c.*, 
        (
          CASE
            WHEN c.patron = ? THEN 100
            WHEN ? LIKE CONCAT('%', c.patron, '%') THEN 75
            WHEN CONCAT(' ', ?, ' ') LIKE CONCAT('% ', c.patron, ' %') THEN 70
            ELSE (
              SELECT COUNT(*) * 10 FROM (
                SELECT UNNEST(?) AS token
              ) AS tokens
              WHERE CONCAT(' ', c.patron, ' ') LIKE CONCAT('% ', token, ' %')
            )
          END
        ) AS puntuacion
      FROM chatbot c
      HAVING puntuacion > 0
      ORDER BY puntuacion DESC, c.prioridad DESC
      LIMIT 1
    `;
    
    // Preparar array de tokens para la consulta
    const tokensParam = JSON.stringify(tokens);
    
    const intenciones = await executeQuery(
      queryPuntuacion,
      [mensaje, mensaje, mensaje, tokensParam]
    );
    
    if (intenciones.length > 0 && intenciones[0].puntuacion >= 30) {
      logger.debug(`Intención encontrada (puntuación: ${intenciones[0].puntuacion}): ${intenciones[0].patron}`);
      return intenciones[0];
    }
    
    // 3. Búsqueda por palabras clave del mensaje con umbral mejorado
    const queryPalabras = `
      SELECT c.*, COUNT(*) as coincidencias
      FROM chatbot c, JSON_TABLE(?, '$[*]' COLUMNS(token VARCHAR(50) PATH '$')) AS t
      WHERE CONCAT(' ', c.patron, ' ') LIKE CONCAT('% ', t.token, ' %')
      GROUP BY c.id
      HAVING coincidencias >= 2
      ORDER BY coincidencias DESC, c.prioridad DESC
      LIMIT 1
    `;
    
    const intencionesPalabras = await executeQuery(
      queryPalabras, 
      [tokensParam]
    );
    
    if (intencionesPalabras.length > 0) {
      logger.debug(`Intención encontrada (coincidencias por palabras: ${intencionesPalabras[0].coincidencias}): ${intencionesPalabras[0].patron}`);
      return intencionesPalabras[0];
    }
    
    // 4. Búsqueda por categoría basada en entidades detectadas
    const entidades = extraerEntidades(mensaje);
    let categoria = null;
    
    if (entidades.tratamientos && entidades.tratamientos.length > 0) categoria = 'Servicios';
    else if (entidades.horarios) categoria = 'Horario';
    else if (entidades.contacto) categoria = 'Contacto';
    else if (entidades.citas) categoria = 'Citas';
    else if (entidades.pago) categoria = 'Precios';
    else if (entidades.redes) categoria = 'Redes';
    else if (entidades.legal) categoria = 'Legal';
    else if (entidades.empresa) categoria = 'Empresa';
    
    if (categoria) {
      const queryCategoria = `
        SELECT * FROM chatbot
        WHERE categoria = ?
        ORDER BY prioridad DESC
        LIMIT 1
      `;
      
      const intencionesCategoria = await executeQuery(queryCategoria, [categoria]);
      
      if (intencionesCategoria.length > 0) {
        logger.debug(`Intención encontrada (por categoría ${categoria}): ${intencionesCategoria[0].patron}`);
        return intencionesCategoria[0];
      }
    }
    
    // Si llegamos aquí, no se encontró ninguna intención que coincida
    logger.info(`No se encontró intención para el mensaje: "${mensaje.substring(0, 50)}..."`);
    return null;
    
  } catch (error) {
    logger.error(`Error al buscar intención: ${error.message}`);
    throw error;
  }
}

// Genera una respuesta basada en la intención detectada y las entidades
async function generarRespuesta(intencion, mensaje, entidades, contexto = {}) {
  try {
    // 1. Verificar si la intención requiere una consulta a la base de datos
    let datosConsulta = null;
    
    // Verificar primero casos con mayor prioridad para respuestas más específicas
    
    // Caso 1: Consulta de horario de día específico
    if (entidades.horarios && entidades.dia_especifico) {
      const horarioDia = await consultarHorarioPorDia(entidades.dia_especifico);
      
      if (!horarioDia.error) {
        return {
          respuesta: `Los horarios de atención para el día ${horarioDia.dia} son: ${horarioDia.texto_horarios}.`,
          tipo: "Horario",
          subtipo: "dia_especifico",
          datos: horarioDia,
          entidades
        };
      } else {
        return {
          respuesta: horarioDia.error,
          tipo: "Horario",
          subtipo: "dia_no_disponible",
          datos: horarioDia,
          entidades
        };
      }
    }
    
    // Caso 2: Consulta sobre tratamiento específico con precio
    if (entidades.tratamientos.length > 0 && entidades.pago) {
      const tratamiento = entidades.tratamientos[0];
      const datoTratamiento = await consultarTratamiento(tratamiento);
      
      if (datoTratamiento && !datoTratamiento.error) {
        return {
          respuesta: `El precio del tratamiento de ${datoTratamiento.nombre} es de $${datoTratamiento.precio} MXN.`,
          tipo: "Precios",
          subtipo: "precio_especifico",
          datos: datoTratamiento,
          entidades
        };
      }
    }
    
    // Si hay tratamientos específicos mencionados, priorizarlos en la consulta
    const hayTratamientoEspecifico = entidades.tratamientos && 
                                    entidades.tratamientos.length > 0 && 
                                    intencion.categoria === 'Servicios';
    
    if (hayTratamientoEspecifico) {
      const tratamiento = entidades.tratamientos[0];
      datosConsulta = await consultarTratamiento(tratamiento);
      
      // Si no encontramos información específica, pero tenemos una intención general
      if (datosConsulta?.error && intencion.categoria === 'Servicios') {
        datosConsulta = await consultarTratamientos();
      }
    } 
    // Si no hay tratamientos específicos, pero hay una intención definida
    else if (intencion.categoria) {
      datosConsulta = await realizarConsultaSegunCategoria(intencion, mensaje, entidades);
    }
    
    // 2. Obtener una respuesta aleatoria de las disponibles
    const respuesta = seleccionarRespuestaAleatoria(intencion.respuestas || intencion.respuesta);
    
    // 3. Si hay datos de consulta y la respuesta es una plantilla, reemplazar variables
    let respuestaFinal = respuesta;
    
    if (datosConsulta) {
      if (intencion.es_plantilla === 1) {
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
    
    // 4. Personalizar respuesta según combinaciones específicas de entidades
    respuestaFinal = personalizarRespuestaSegunEntidades(respuestaFinal, entidades, datosConsulta);
    
    // 5. Devolver respuesta formateada
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

// Personaliza la respuesta según combinaciones específicas de entidades
function personalizarRespuestaSegunEntidades(respuesta, entidades, datos) {
  // Caso 1: Si se consulta por un tratamiento específico y sus horarios
  if (entidades.tratamientos.length > 0 && entidades.horarios && datos && datos.nombre) {
    const nombreTratamiento = datos.nombre || datos.servicio || entidades.tratamientos[0];
    
    // Si la respuesta ya incluye esta información, no modificarla
    if (respuesta.includes(nombreTratamiento) && respuesta.includes("horario")) {
      return respuesta;
    }
    
    return `${respuesta} Para agendar una cita para ${nombreTratamiento}, puedes contactarnos en nuestro horario de atención.`;
  }
  
  // Caso 2: Si se consulta por un tratamiento y su duración específica
  if (entidades.tratamientos.length > 0 && datos && datos.duracion && 
      !respuesta.includes("duración") && !respuesta.includes("duración")) {
    
    const nombreTratamiento = datos.nombre || datos.servicio || entidades.tratamientos[0];
    const duracionInfo = datos.duracion || "variable según el caso";
    
    return `${respuesta} El tiempo aproximado para el tratamiento de ${nombreTratamiento} es ${duracionInfo}.`;
  }
  
  // Caso 3: Añadir recomendación sobre citas en consultas específicas
  if ((entidades.tratamientos.length > 0 || entidades.pago) && 
      !entidades.citas && !respuesta.includes("cita") && !respuesta.includes("agendar")) {
    
    return `${respuesta} Te recomendamos agendar una cita para una evaluación personalizada.`;
  }
  
  return respuesta;
}

// Verifica si existe un valor por defecto para una variable
function tieneValorPorDefecto(datos, variable) {
  // Mapeo de variables a posibles alternativas
  const alternativas = {
    'servicio': ['title', 'nombre', 'nombre_servicio', 'tratamiento'],
    'duracion': ['duration', 'tiempo', 'minutos'],
    'horarios': ['horario', 'horas_atencion'],
    'redes': ['redes_sociales', 'redes_lista'],
    'direccion': ['calle_numero', 'ubicacion', 'domicilio', 'direccion_completa'],
    'telefono': ['telefono_principal', 'contacto', 'celular'],
    'precio': ['price', 'costo', 'valor'],
    'descripcion': ['description', 'detalle', 'informacion'],
    'contenido': ['texto', 'body', 'info']
  };
  
  // Verificar alternativas
  if (alternativas[variable]) {
    return alternativas[variable].some(alt => datos[alt] !== undefined);
  }
  
  return false;
}

// Realiza una consulta según la categoría de la intención
async function realizarConsultaSegunCategoria(intencion, mensaje, entidades) {
  try {
    switch (intencion.categoria) {
      case 'Horario':
        // Si hay un día específico mencionado, consultar ese día
        if (entidades.dia_especifico) {
          return await consultarHorarioPorDia(entidades.dia_especifico);
        }
        return await consultarHorarios();
      
      case 'Contacto':
        return await consultarContacto();
      
      case 'Servicios':
        if (entidades.tratamientos && entidades.tratamientos.length > 0) {
          return await consultarTratamiento(entidades.tratamientos[0]);
        } else {
          return await consultarTratamientos();
        }
      
      case 'Citas':
        return await consultarInfoCitas();
      
      case 'Precios':
        if (entidades.tratamientos && entidades.tratamientos.length > 0) {
          const infoTratamiento = await consultarTratamiento(entidades.tratamientos[0]);
          if (infoTratamiento && !infoTratamiento.error) {
            return {
              servicio: infoTratamiento.servicio || infoTratamiento.nombre,
              precio: infoTratamiento.precio || infoTratamiento.price,
              duracion: infoTratamiento.duracion || infoTratamiento.duration,
              descripcion: infoTratamiento.descripcion || infoTratamiento.description
            };
          }
        }
        return await consultarPreciosGenerales();
      
      case 'Legal':
        if (mensaje.includes("privacidad") || mensaje.includes("datos personales")) {
          return await consultarInfoLegal("inf_politicas_privacidad");
        } else if (mensaje.includes("terminos") || mensaje.includes("condiciones")) {
          return await consultarInfoLegal("inf_terminos_condiciones");
        } else {
          return await consultarInfoLegal("inf_deslinde");
        }
      
      case 'Redes':
        return await consultarRedesSociales();
      
      case 'Empresa':
        if (mensaje.includes("historia")) {
          return await consultarAcercaDe("Historia");
        } else if (mensaje.includes("mision")) {
          return await consultarAcercaDe("Misión");
        } else if (mensaje.includes("vision")) {
          return await consultarAcercaDe("Visión");
        } else if (mensaje.includes("valores")) {
          return await consultarAcercaDe("Valores");
        } else {
          return await consultarPerfilEmpresa();
        }
      
      default:
        // Consulta genérica para otras categorías
        if (intencion.tabla_consulta && intencion.campo_consulta) {
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

// Consulta información "Acerca de" (Historia, Misión, etc.)
async function consultarAcercaDe(tipo) {
  try {
    const query = `
      SELECT * FROM acerca_de
      WHERE tipo = ?
      LIMIT 1
    `;
    
    const resultado = await executeQuery(query, [tipo]);
    
    if (resultado.length === 0) {
      return { 
        error: `No se encontró información sobre ${tipo.toLowerCase()}`,
        tipo: tipo
      };
    }
    
    return resultado[0];
    
  } catch (error) {
    logger.error(`Error al consultar acerca de: ${error.message}`);
    return { error: "Error al obtener la información institucional" };
  }
}

// Consulta información de contacto
async function consultarContacto() {
  try {
    const query = "SELECT * FROM inf_perfil_empresa LIMIT 1";
    const resultado = await executeQuery(query);
    
    if (resultado.length === 0) {
      return { error: "No se encontró información de contacto" };
    }
    
    // Obtener también redes sociales para complementar
    const redes = await consultarRedesSociales();
    
    // Formatear dirección completa
    if (resultado[0].calle_numero && resultado[0].localidad) {
      resultado[0].direccion_completa = `${resultado[0].calle_numero}, ${resultado[0].localidad}, ${resultado[0].municipio || ''}, ${resultado[0].estado || ''}${resultado[0].codigo_postal ? ', C.P. ' + resultado[0].codigo_postal : ''}`.replace(/,\s+,/g, ',').replace(/,\s+$/g, '');
    }
    
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

// Selecciona una respuesta aleatoria de las disponibles
function seleccionarRespuestaAleatoria(respuestasStr) {
  try {
    if (!respuestasStr) {
      logger.warn("Se intentó seleccionar una respuesta de un string vacío");
      return "Lo siento, no tengo una respuesta para eso.";
    }
    
    // Las respuestas están separadas por |||
    const respuestas = respuestasStr.split('|||')
      .map(r => r.trim())
      .filter(r => r);
    
    if (respuestas.length === 0) {
      logger.warn("No se encontraron respuestas válidas en el string");
      return "Lo siento, no tengo una respuesta para eso.";
    }
    
    // Seleccionar una aleatoriamente
    const indice = Math.floor(Math.random() * respuestas.length);
    return respuestas[indice];
  } catch (error) {
    logger.error(`Error al seleccionar respuesta aleatoria: ${error.message}`);
    return "Lo siento, ocurrió un error al procesar la respuesta.";
  }
}

// Consulta horarios por día específico
async function consultarHorarioPorDia(dia) {
  try {
    // Normalizar el día
    const diaNormalizado = normalizarDia(dia);
    
    // Validar que sea un día válido
    const diasValidos = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    
    if (!diasValidos.includes(diaNormalizado) && diaNormalizado !== 'fin_semana') {
      return { 
        error: `Día no válido. Debe ser uno de: ${diasValidos.join(", ")}`,
        dia: diaNormalizado
      };
    }
    
    // Caso especial para fin de semana
    if (diaNormalizado === 'fin_semana') {
      const sabado = await consultarHorarioPorDia('Sábado');
      const domingo = await consultarHorarioPorDia('Domingo');
      
      let mensaje = "";
      
      if (!sabado.error) {
        mensaje += `Sábado: ${sabado.texto_horarios}. `;
      } else {
        mensaje += "No atendemos los sábados. ";
      }
      
      if (!domingo.error) {
        mensaje += `Domingo: ${domingo.texto_horarios}`;
      } else {
        mensaje += "No atendemos los domingos.";
      }
      
      return {
        dia: "Fin de semana",
        texto_horarios: mensaje,
        sabado: sabado,
        domingo: domingo
      };
    }
    
    const query = `
      SELECT h.*, e.nombre as nombre_empleado 
      FROM horarios h
      LEFT JOIN empleados e ON h.empleado_id = e.id
      WHERE h.dia_semana = ?
      ORDER BY h.hora_inicio
    `;
    
    const horarios = await executeQuery(query, [diaNormalizado]);
    
    if (horarios.length === 0) {
      return {
        error: `No atendemos los ${diaNormalizado.toLowerCase()}`,
        dia: diaNormalizado,
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
    
    // Generar texto específico para este día
    const textoHorarios = horariosFormateados
      .map(h => h.horario)
      .filter((v, i, a) => a.indexOf(v) === i) // Eliminar duplicados
      .join(", ");
    
    return {
      dia: diaNormalizado,
      horarios: horariosFormateados,
      texto_horarios: textoHorarios
    };
    
  } catch (error) {
    logger.error(`Error al consultar horario por día: ${error.message}`);
    return { 
      error: `No pudimos obtener información para el día ${dia}`,
      dia: dia
    };
  }
}

// Normaliza el nombre del día
function normalizarDia(dia) {
  if (dia === 'fin_semana') return dia;
  
  // Mapeo de posibles variaciones
  const mapDias = {
    'lun': 'Lunes',
    'mar': 'Martes',
    'mie': 'Miércoles',
    'jue': 'Jueves',
    'vie': 'Viernes',
    'sab': 'Sábado',
    'dom': 'Domingo',
    'fin de semana': 'fin_semana',
    'fines de semana': 'fin_semana',
    'sabados y domingos': 'fin_semana',
    'sábados y domingos': 'fin_semana'
  };
  
  // Verificar si es un nombre corto
  if (mapDias[dia.toLowerCase()]) {
    return mapDias[dia.toLowerCase()];
  }
  
  // Normalizar primera letra mayúscula
  const diaNormalizado = dia.charAt(0).toUpperCase() + dia.slice(1).toLowerCase();
  
  // Correcciones específicas
  if (diaNormalizado === 'Sabado') return 'Sábado';
  if (diaNormalizado === 'Miercoles') return 'Miércoles';
  
  return diaNormalizado;
}

// Consulta los horarios disponibles
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

// Formatea los horarios para mostrarlos de manera amigable
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

// Consulta información sobre las citas de un paciente
async function consultarCitasPaciente(identificador) {
  try {
    if (!identificador) {
      return { 
        error: "Se requiere un correo electrónico o número telefónico para consultar tus citas"
      };
    }
    
    // Verificar si es un correo o teléfono
    const esCorreo = identificador.includes('@');
    
    // Consulta para buscar al paciente
    const queryPaciente = esCorreo 
      ? "SELECT id FROM citas WHERE correo = ?"
      : "SELECT id FROM citas WHERE telefono = ?";
    
    const paciente = await executeQuery(queryPaciente, [identificador]);
    
    if (paciente.length === 0) {
      return {
        error: `No se encontraron citas asociadas con este ${esCorreo ? 'correo' : 'teléfono'}`,
        mensaje: "Verifica que hayas proporcionado la información correcta o ponte en contacto con nosotros directamente para agendar una cita."
      };
    }
    
    // Consultar las citas pendientes del paciente
    const queryCitas = `
      SELECT c.*, 
             s.title as servicio_nombre,
             s.category as servicio_categoria,
             o.nombre as odontologo_nombre
      FROM citas c
      LEFT JOIN servicios s ON c.servicio_id = s.id
      LEFT JOIN empleados o ON c.odontologo_id = o.id
      WHERE c.${esCorreo ? 'correo' : 'telefono'} = ? 
        AND c.estado = 'Pendiente'
      ORDER BY c.fecha_consulta ASC
    `;
    
    const citas = await executeQuery(queryCitas, [identificador]);
    
    if (citas.length === 0) {
      return {
        mensaje: `No tienes citas pendientes asociadas con este ${esCorreo ? 'correo' : 'teléfono'}`,
        sugerencia: "Si deseas agendar una nueva cita, te recomendamos contactarnos por teléfono o visitar nuestra página web."
      };
    }
    
    // Formatear las citas para una respuesta amigable
    const citasFormateadas = citas.map(cita => {
      // Formatear fecha y hora para presentación
      const fecha = new Date(cita.fecha_consulta);
      const fechaStr = fecha.toLocaleDateString('es-MX', {
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric'
      });
      
      const horaStr = fecha.toLocaleTimeString('es-MX', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      
      return {
        id: cita.id,
        fecha: fechaStr,
        hora: horaStr,
        servicio: cita.servicio_nombre || 'Consulta general',
        odontologo: cita.odontologo_nombre || 'Por asignar',
        estado: cita.estado,
        notas: cita.notas || ''
      };
    });
    
    return {
      mensaje: `Encontramos ${citas.length} cita(s) pendiente(s) para ti:`,
      citas: citasFormateadas,
      recordatorio: "Recuerda llegar 15 minutos antes de tu cita. Para cancelar o reprogramar, favor de contactarnos con al menos 24 horas de anticipación."
    };
    
  } catch (error) {
    logger.error(`Error al consultar citas del paciente: ${error.message}`);
    return { error: "Hubo un problema al consultar tus citas. Por favor, intenta de nuevo más tarde o contáctanos directamente." };
  }
}

// Consulta información sobre precios generales
async function consultarPreciosGenerales() {
  try {
    const query = `
      SELECT category, 
             MIN(price) as precio_min, 
             MAX(price) as precio_max,
             COUNT(*) as total_servicios
      FROM servicios
      GROUP BY category
      ORDER BY category
    `;
    
    const resultados = await executeQuery(query);
    
    if (resultados.length === 0) {
      return { error: "No se encontró información de precios" };
    }
    
    // Formatear en texto amigable
    let resumen = "Nuestros precios varían según el tratamiento:\n";
    
    resultados.forEach(cat => {
      resumen += `- ${cat.category}: desde $${cat.precio_min} hasta $${cat.precio_max} MXN\n`;
    });
    
    return {
      precios_texto: resumen,
      categorias: resultados,
      metodos_pago: "Aceptamos efectivo, tarjetas de crédito/débito y transferencias bancarias.",
      promociones: "Consulta nuestras promociones vigentes y descuentos para pacientes frecuentes."
    };
    
  } catch (error) {
    logger.error(`Error al consultar precios generales: ${error.message}`);
    return { error: "No pudimos obtener la información sobre precios" };
  }
}

// Consulta información legal (términos, deslinde, etc.)
async function consultarInfoLegal(tabla) {
  try {
    // Validar el nombre de la tabla para evitar SQL injection
    const tablasPermitidas = ["inf_deslinde", "inf_terminos_condiciones", "inf_politicas_privacidad"];
    
    if (!tablasPermitidas.includes(tabla)) {
      return { 
        error: "Documento legal no disponible en la base de datos"
      };
    }
    
    // Extraer el tipo de documento del nombre de la tabla
    let tipoDocumento = "legal";
    if (tabla === "inf_deslinde") tipoDocumento = "deslinde";
    else if (tabla === "inf_terminos_condiciones") tipoDocumento = "terminos";
    else if (tabla === "inf_politicas_privacidad") tipoDocumento = "privacidad";
    
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
    
    documento.tipo_documento = tipoDocumento;
    
    return documento;
    
  } catch (error) {
    logger.error(`Error al consultar info legal: ${error.message}`);
    return { 
      error: "Error en la consulta a la base de datos para obtener información legal"
    };
  }
}

// Consulta redes sociales
async function consultarRedesSociales() {
  try {
    const query = "SELECT * FROM inf_redes_sociales ORDER BY nombre_red";
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

// Consulta datos del perfil de la empresa
async function consultarPerfilEmpresa() {
  try {
    const query = "SELECT * FROM inf_perfil_empresa LIMIT 1";
    const resultado = await executeQuery(query);
    
    if (resultado.length === 0) {
      return { error: "No se encontró información del perfil de empresa" };
    }
    
    const empresa = resultado[0];
    
    // Formatear dirección completa
    if (empresa.calle_numero && empresa.localidad) {
      empresa.direccion_completa = `${empresa.calle_numero}, ${empresa.localidad}, ${empresa.municipio || ''}, ${empresa.estado || ''}${empresa.codigo_postal ? ', C.P. ' + empresa.codigo_postal : ''}`.replace(/,\s+,/g, ',').replace(/,\s+$/g, '');
    }
    
    return empresa;
    
  } catch (error) {
    logger.error(`Error al consultar perfil de empresa: ${error.message}`);
    return { error: "Error al obtener información de la empresa" };
  }
}

// Consulta servicios y tratamientos disponibles
async function consultarTratamientos() {
  try {
    const query = `
      SELECT id, title, description, category, price, duration, image_url,
             CASE 
               WHEN category IN ('Periodoncia', 'Ortodoncia', 'Cirugía') THEN TRUE
               ELSE FALSE
             END as es_tratamiento
      FROM servicios
      ORDER BY category, title
    `;
    
    const servicios = await executeQuery(query);
    
    if (servicios.length === 0) {
      return { 
        error: "No se encontraron servicios disponibles en la base de datos"
      };
    }
    
    // Agrupar servicios por categoría
    const serviciosPorCategoria = {};
    
    // Separar tratamientos y servicios normales
    const tratamientos = [];
    const serviciosNormales = [];
    
    servicios.forEach(s => {
      if (!serviciosPorCategoria[s.category]) {
        serviciosPorCategoria[s.category] = [];
      }
      
      const servicioData = {
        id: s.id,
        nombre: s.title,
        duracion: s.duration,
        precio: s.price,
        descripcion: s.description,
        es_tratamiento: s.es_tratamiento === 1
      };
      
      serviciosPorCategoria[s.category].push(servicioData);
      
      // Clasificar en tratamiento o servicio normal
      if (s.es_tratamiento === 1) {
        tratamientos.push(servicioData);
      } else {
        serviciosNormales.push(servicioData);
      }
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
    
    // Lista específica de tratamientos
    const nombresTratamientos = tratamientos.map(t => t.nombre);
    
    // Lista específica de servicios normales
    const nombresServicios = serviciosNormales.map(s => s.nombre);
    
    return { 
      servicios: listaServicios,
      serviciosPorCategoria: serviciosPorCategoria,
      lista_servicios: todosServicios,
      tratamientos: nombresTratamientos,
      servicios_normales: nombresServicios,
      total_servicios: servicios.length,
      total_tratamientos: tratamientos.length,
      total_servicios_normales: serviciosNormales.length
    };
    
  } catch (error) {
    logger.error(`Error al consultar servicios y tratamientos: ${error.message}`);
    return { 
      error: "Error en la consulta a la base de datos para obtener servicios y tratamientos"
    };
  }
}

// Consulta los detalles de un tratamiento específico
async function consultarTratamiento(nombreTratamiento) {
  try {
    if (!nombreTratamiento) {
      return { error: "No se especificó ningún tratamiento" };
    }
    
    // Aplicar correcciones ortográficas y mejorar la búsqueda
    const nombreCorregido = corregirErroresOrtograficos(nombreTratamiento);
    
    // Incorporar sinónimos para ampliar búsqueda
    const sinonimos = expandirSinonimos(nombreCorregido);
    const condicionesBusqueda = [
      `title = '${nombreCorregido}'`, 
      `title LIKE '%${nombreCorregido}%'`,
      `description LIKE '%${nombreCorregido}%'`
    ];
    
    // Agregar sinónimos a la búsqueda
    sinonimos.forEach(sinonimo => {
      condicionesBusqueda.push(`title LIKE '%${sinonimo}%'`);
      condicionesBusqueda.push(`description LIKE '%${sinonimo}%'`);
    });
    
    // Consulta principal para encontrar el tratamiento
    const query = `
      SELECT s.id, s.title, s.description, s.duration, s.category, s.price, s.image_url,
             CASE 
               WHEN s.category IN ('Periodoncia', 'Ortodoncia', 'Cirugía') THEN TRUE
               ELSE FALSE
             END as es_tratamiento,
             CASE
               WHEN s.title = ? THEN 100
               WHEN s.title LIKE ? THEN 80
               WHEN s.description LIKE ? THEN 60
               ELSE (
                 SELECT COUNT(*) * 10 FROM (
                   SELECT unnest(ARRAY[${sinonimos.map(() => '?').join(', ')}]) AS term
                 ) AS terms
                 WHERE s.title LIKE CONCAT('%', term, '%') OR s.description LIKE CONCAT('%', term, '%')
               )
             END as relevancia
      FROM servicios s
      WHERE ${condicionesBusqueda.join(' OR ')}
      HAVING relevancia > 0
      ORDER BY relevancia DESC, LENGTH(s.title) ASC
      LIMIT 1
    `;
    
    // Preparar parámetros para la consulta
    const params = [
      nombreCorregido, 
      `%${nombreCorregido}%`,
      `%${nombreCorregido}%`,
      ...sinonimos
    ];
    
    const servicios = await executeQuery(query, params);
    
    if (servicios.length === 0) {
      // Si no encuentra el tratamiento, realizar una búsqueda más flexible por palabras clave
      const palabrasClaves = nombreCorregido.split(/\s+/).filter(p => p.length > 3);
      
      if (palabrasClaves.length > 0) {
        let queryPalabras = `
          SELECT s.id, s.title, s.description, s.duration, s.category, s.price, s.image_url,
                 CASE 
                   WHEN s.category IN ('Periodoncia', 'Ortodoncia', 'Cirugía') THEN TRUE
                   ELSE FALSE
                 END as es_tratamiento,
                 COUNT(*) as coincidencias
          FROM servicios s
          WHERE 1=0`;
        
        // Agregar cada palabra clave a la búsqueda
        palabrasClaves.forEach(palabra => {
          queryPalabras += ` OR s.title LIKE '%${palabra}%' OR s.description LIKE '%${palabra}%'`;
        });
        
        queryPalabras += ` 
          GROUP BY s.id
          ORDER BY coincidencias DESC, s.title
          LIMIT 1
        `;
        
        const serviciosPorPalabras = await executeQuery(queryPalabras);
        
        if (serviciosPorPalabras.length > 0) {
          const servicio = serviciosPorPalabras[0];
          
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
            precio: servicio.price || "Consultar",
            categoria: servicio.category,
            descripcion: servicio.description,
            es_tratamiento: servicio.es_tratamiento === 1, // Usando bandera específica de tratamiento
            detalles: detalles,
            beneficios: obtenerDetallesPorTipo(detalles, 'beneficio'),
            incluye: obtenerDetallesPorTipo(detalles, 'incluye'),
            precauciones: obtenerDetallesPorTipo(detalles, 'precaucion')
          };
        }
      }
      
      // Si aún no encuentra, obtener lista de tratamientos disponibles para sugerir
      const todosTratamientos = await consultarTratamientos();
      
      let sugerencias = "No hay servicios similares disponibles.";
      
      if (!todosTratamientos.error && todosTratamientos.lista_servicios?.length > 0) {
        // Obtener hasta 5 tratamientos para sugerir
        sugerencias = todosTratamientos.lista_servicios.slice(0, 5).join(", ");
      }
      
      return { 
        error: `No se encontró el servicio "${nombreTratamiento}" en nuestro catálogo`,
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
      precio: servicio.price || "Consultar",
      categoria: servicio.category,
      descripcion: servicio.description,
      es_tratamiento: servicio.es_tratamiento === 1, // Usando bandera específica de tratamiento
      detalles: detalles,
      beneficios: obtenerDetallesPorTipo(detalles, 'beneficio'),
      incluye: obtenerDetallesPorTipo(detalles, 'incluye'),
      precauciones: obtenerDetallesPorTipo(detalles, 'precaucion')
    };
    
  } catch (error) {
    logger.error(`Error al consultar tratamiento: ${error.stack}`);
    return { 
      error: "Error en la consulta a la base de datos para obtener detalles del servicio"
    };
  }
}

// Filtra los detalles de un tratamiento por tipo
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

// Consulta genérica para cualquier tabla
async function consultaGenerica(tabla, campo, condicion) {
  try {
    // Lista de tablas permitidas para consulta
    const tablasPermitidas = [
      'chatbot', 'horarios', 'inf_deslinde', 
      'inf_perfil_empresa', 'inf_politicas_privacidad', 
      'inf_redes_sociales', 'inf_terminos_condiciones',
      'preguntas_frecuentes', 'servicios', 'servicio_detalles',
      'acerca_de', 'citas'
    ];
    
    // Validar el nombre de la tabla para evitar SQL injection
    if (!tablasPermitidas.includes(tabla)) {
      return { error: "Tabla no permitida" };
    }
    
    // Mapeo de campos permitidos por tabla
    const camposPermitidos = {
      'chatbot': ['id', 'patron', 'categoria', 'respuestas', 'es_plantilla', 'tabla_consulta', 'campo_consulta', 'condicion', 'prioridad', 'fecha_creacion', '*'],
      'acerca_de': ['id', 'tipo', 'descripcion', 'fecha_creacion', 'fecha_actualizacion', '*'],
      'servicios': ['id', 'title', 'description', 'category', 'duration', 'price', 'image_url', 'tratamiento', 'citasEstimadas', 'image_name', '*']
    };
    
    // Validar los campos para evitar SQL injection
    if (campo !== '*') {
      const camposArray = campo.split(',').map(c => c.trim());
      const camposValidados = camposPermitidos[tabla] || [];
      
      if (!camposArray.every(c => camposValidados.includes(c) || c === '*')) {
        return { error: "Campos no válidos para esta tabla" };
      }
    }
    
    // Construir la consulta base
    let query = `SELECT ${campo} FROM ${tabla}`;
    let params = [];
    
    // Agregar condición si existe
    if (condicion) {
      // Extraer variables de la condición para usar parámetros
      // Esto es una versión simplificada, para una implementación completa habría que parsear la condición
      if (condicion.includes('=') && condicion.includes("'")) {
        const matches = condicion.match(/([a-zA-Z0-9_]+)\s*=\s*'([^']+)'/);
        if (matches && matches.length === 3) {
          query += ` WHERE ${matches[1]} = ?`;
          params.push(matches[2]);
        } else {
          query += ` WHERE ${condicion}`;
        }
      } else {
        query += ` WHERE ${condicion}`;
      }
    }
    
    // Limitar resultados por seguridad
    query += " LIMIT 10";
    
    const resultados = await executeQuery(query, params);
    
    if (resultados.length === 0) {
      return { error: "No se encontraron resultados" };
    }
    
    // Extraer los valores para plantillas dependiendo de la tabla consultada
    let respuesta = { resultados };
    
    // Para algunas tablas, preparar formatos específicos para las plantillas
    if (tabla === 'servicios' && campo === '*') {
      respuesta.servicios = resultados.map(s => s.title).join(', ');
    } else if (tabla === 'acerca_de' && condicion?.includes("tipo = 'Historia'")) {
      respuesta.descripcion = resultados[0]?.descripcion || '';
    }
    
    return respuesta;
    
  } catch (error) {
    logger.error(`Error en consulta genérica: ${error.message}`);
    return { error: "Error al realizar la consulta" };
  }
}

// Consulta información para citas genéricas (no de un paciente específico)
async function consultarInfoCitas() {
  try {
    // Consultar información general sobre citas
    const query = `
      SELECT 'consulta_sobre_servicio' as patron,
             'Servicios' as categoria,
             'El servicio {{servicio}} tiene un costo de ${{precio}} MXN y una duración aproximada de {{duracion}}. {{descripcion}} ¿Te gustaría agendar una cita?' as respuestas,
             1 as es_plantilla
      FROM chatbot
      WHERE patron = 'consulta_sobre_servicio'
      AND categoria = 'Servicios'
      AND es_plantilla = 1
      LIMIT 1
    `;
    
    const resultado = await executeQuery(query);
    
    if (resultado.length === 0) {
      return {
        mensaje: "Para agendar una cita, puedes llamar a nuestro número telefónico o dejarnos tus datos para contactarte.",
        proceso: "Para programar una cita, comunícate a nuestro teléfono o proporciónanos tus datos de contacto."
      };
    }
    
    // Obtener información de contacto para incluir en la respuesta
    const contacto = await consultarContacto();
    
    return {
      mensaje: "Para agendar una cita, puedes contactarnos directamente.",
      proceso: "El proceso para agendar una cita es sencillo, solo necesitas comunicarte con nosotros por teléfono o correo.",
      telefono: contacto.telefono_principal || "No disponible",
      correo: contacto.correo_electronico || "No disponible",
      horarios: await consultarHorarios(),
      recomendaciones: "Te recomendamos llegar 15 minutos antes de tu cita programada y traer identificación."
    };
    
  } catch (error) {
    logger.error(`Error al consultar información de citas: ${error.message}`);
    return {
      error: "Error al obtener información sobre citas",
      mensaje: "Para agendar una cita, comunícate directamente a nuestro número telefónico."
    };
  }
}

// Reemplaza variables de plantilla con datos reales
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

// Obtiene alternativas para una variable
function obtieneAlternativasVariable(variable) {
  // Mapeo de variables a posibles alternativas
  const alternativas = {
    'servicio': ['title', 'nombre', 'nombre_servicio', 'tratamiento'],
    'duracion': ['duration', 'tiempo', 'minutos'],
    'horarios': ['horario', 'horas_atencion'],
    'redes': ['redes_sociales', 'redes_lista'],
    'direccion': ['calle_numero', 'ubicacion', 'domicilio', 'direccion_completa'],
    'telefono': ['telefono_principal', 'contacto', 'celular'],
    'precio': ['price', 'costo', 'valor'],
    'descripcion': ['description', 'detalle', 'informacion'],
    'contenido': ['texto', 'body', 'info']
  };
  
  return alternativas[variable] || [];
}

// Obtiene un valor predeterminado para variables no encontradas
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
      
    case 'precio':
    case 'price':
      return "consultar en clínica";
      
    default:
      return "";
  }
}

// Endpoint para obtener las preguntas frecuentes
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
      total: preguntas.length 
    });
    
  } catch (error) {
    logger.error(`Error al obtener preguntas frecuentes: ${error.message}`);
    
    return res.status(500).json({ 
      error: "Error al obtener preguntas frecuentes de la base de datos",
      preguntas: [],
      total: 0
    });
  }
});

// Endpoint para obtener patrones del chatbot
router.get("/patrones", async (req, res) => {
  try {
    // Filtrar por categoría si se especifica
    const { categoria } = req.query;
    
    let query = `
      SELECT id, patron, categoria, respuestas, prioridad 
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

// Endpoint para obtener información de tratamientos
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

// Endpoint para obtener detalles de un tratamiento
router.get("/tratamiento", async (req, res) => {
  try {
    const { nombre, id } = req.query;
    
    if (!nombre && !id) {
      return res.status(400).json({ error: "Debe especificar el nombre o ID del tratamiento" });
    }
    
    let datos;
    
    if (id) {
      datos = await consultarTratamientoPorId(id);
    } else {
      datos = await consultarTratamiento(nombre);
    }
    
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

// Endpoint para obtener horarios
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

// Endpoint para obtener información de la empresa
router.get("/perfil-empresa", async (req, res) => {
  try {
    const datos = await consultarPerfilEmpresa();
    
    if (datos.error) {
      return res.status(404).json(datos);
    }
    
    return res.json(datos);
    
  } catch (error) {
    logger.error(`Error al obtener perfil de empresa: ${error.message}`);
    return res.status(500).json({
      error: "Error en la consulta a la base de datos para obtener perfil de empresa"
    });
  }
});

// Endpoint para obtener información "Acerca de"
router.get("/acerca-de", async (req, res) => {
  try {
    const { tipo } = req.query;
    let datos;
    
    if (tipo) {
      datos = await consultarAcercaDe(tipo);
    } else {
      // Obtener todos los tipos
      const query = "SELECT * FROM acerca_de ORDER BY tipo";
      const resultados = await executeQuery(query);
      
      if (resultados.length === 0) {
        return res.status(404).json({ 
          error: "No se encontró información institucional"
        });
      }
      
      // Agrupar por tipo
      const agrupados = {};
      resultados.forEach(item => {
        agrupados[item.tipo] = item;
      });
      
      datos = { 
        tipos: Object.keys(agrupados),
        datos: agrupados
      };
    }
    
    if (datos.error) {
      return res.status(404).json(datos);
    }
    
    return res.json(datos);
    
  } catch (error) {
    logger.error(`Error al obtener información "acerca de": ${error.message}`);
    return res.status(500).json({
      error: "Error en la consulta a la base de datos para obtener información institucional"
    });
  }
});

// Endpoint para obtener redes sociales
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

// Endpoint para obtener documentos legales
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
    
    const datos = await consultarInfoLegal(tabla);
    
    if (datos.error) {
      return res.status(404).json(datos);
    }
    
    return res.json(datos);
    
  } catch (error) {
    logger.error(`Error al obtener documento legal: ${error.message}`);
    return res.status(500).json({ 
      error: "Error en la consulta a la base de datos para obtener documentos legales"
    });
  }
});

// Endpoint para obtener información de citas
router.get("/citas", async (req, res) => {
  try {
    const datos = await consultarInfoCitas();
    
    if (datos.error) {
      return res.status(404).json(datos);
    }
    
    return res.json(datos);
    
  } catch (error) {
    logger.error(`Error al obtener información de citas: ${error.message}`);
    return res.status(500).json({ 
      error: "Error en la consulta a la base de datos para obtener información de citas"
    });
  }
});

// Endpoint de diagnóstico para verificar conexión con la base de datos
router.get("/diagnostico", async (req, res) => {
  try {
    // 1. Verificar tablas principales
    const tablasVerificar = [
      'chatbot', 'acerca_de', 'servicios', 'horarios', 
      'inf_perfil_empresa', 'preguntas_frecuentes'
    ];
    
    const resultadosTablas = {};
    
    for (const tabla of tablasVerificar) {
      try {
        // Verificar existencia de la tabla
        const existeQuery = `
          SELECT COUNT(*) as existe
          FROM information_schema.tables
          WHERE table_schema = DATABASE() AND table_name = ?
        `;
        
        const existeResultado = await executeQuery(existeQuery, [tabla]);
        const existe = existeResultado[0].existe > 0;
        
        // Contar registros si la tabla existe
        let conteo = 0;
        if (existe) {
          const conteoQuery = `SELECT COUNT(*) as total FROM ${tabla}`;
          const conteoResultado = await executeQuery(conteoQuery);
          conteo = conteoResultado[0].total;
        }
        
        resultadosTablas[tabla] = { existe, registros: conteo };
      } catch (error) {
        resultadosTablas[tabla] = { 
          existe: false, 
          error: error.message,
          registros: 0
        };
      }
    }
    
    // 2. Verificar patrones de saludo específicamente
    let patronesSaludo = [];
    try {
      const saludosQuery = `
        SELECT id, patron, LEFT(respuestas, 100) as respuesta_preview, prioridad
        FROM chatbot 
        WHERE categoria = 'General' AND
              (patron = 'hola' OR patron LIKE '%salud%' OR patron LIKE '%buenos%')
        ORDER BY prioridad DESC
      `;
      patronesSaludo = await executeQuery(saludosQuery);
    } catch (error) {
      patronesSaludo = { error: error.message };
    }
    
    // 3. Verificar función extraerEntidades
    let testEntidades = null;
    try {
      const mensajePrueba = "Hola, quiero información sobre limpieza dental y horarios";
      testEntidades = extraerEntidades(mensajePrueba);
    } catch (error) {
      testEntidades = { error: error.message };
    }
    
    // 4. Probar la función consultarAcercaDe
    let testMision = null;
    try {
      testMision = await consultarAcercaDe("Misión");
    } catch (error) {
      testMision = { error: error.message };
    }
    
    // 5. Probar la función buscarIntencion
    let testIntencion = null;
    try {
      testIntencion = await buscarIntencionMejorada("hola");
    } catch (error) {
      testIntencion = { error: error.message };
    }
    
    // Devolver resultados
    return res.json({
      estado: "success",
      mensaje: "Diagnóstico completado",
      tablas: resultadosTablas,
      patronesSaludo,
      testEntidades,
      testMision,
      testIntencion,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`Error en diagnóstico: ${error.stack}`);
    return res.status(500).json({ 
      error: "Error al realizar diagnóstico",
      mensaje: error.message,
      stack: error.stack
    });
  }
});

module.exports = router;