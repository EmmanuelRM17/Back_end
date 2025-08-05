// Archivo: routes/admin/predictions.js

const express = require("express");
const router = express.Router();
const { spawn } = require("child_process");
const nodemailer = require("nodemailer");
const path = require("path");
const db = require("../../db");

// Configuración de nodemailer
const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 465,
  secure: true,
  auth: {
    user: "sistema@odontologiacarol.com",
    pass: "sP8+?;Vs:",
  },
});

/**
 * Obtener historial de no-shows del paciente - CORREGIDO para evitar data leakage
 */
const getPacienteHistorial = (pacienteId, citaActualId = null) => {
  return new Promise((resolve, reject) => {
    // Query corregido: excluye la cita actual para evitar data leakage
    let query = `
      SELECT 
        COUNT(*) as total_citas,
        SUM(CASE WHEN estado IN ('Cancelada', 'No llegó') THEN 1 ELSE 0 END) as total_no_shows,
        COALESCE(
          SUM(CASE WHEN estado IN ('Cancelada', 'No llegó') THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 
          0
        ) as pct_no_show_historico,
        COALESCE(
          DATEDIFF(NOW(), MAX(CASE WHEN estado = 'Completada' THEN fecha_consulta END)),
          0
        ) as dias_desde_ultima_cita
      FROM citas 
      WHERE paciente_id = ? 
      AND fecha_consulta < NOW()
      AND archivado = 0
    `;

    let params = [pacienteId];

    // Si hay cita actual, excluirla del historial para evitar data leakage
    if (citaActualId) {
      query += " AND id != ?";
      params.push(citaActualId);
    }

    console.log("Query historial:", query);
    console.log("Parámetros:", params);

    db.query(query, params, (err, results) => {
      if (err) {
        console.error("Error en query historial:", err);
        reject(err);
      } else {
        const historial = results[0] || {
          total_citas: 0,
          total_no_shows: 0,
          pct_no_show_historico: 0.0,
          dias_desde_ultima_cita: 0,
        };

        // Asegurar que no haya valores null
        historial.total_citas = historial.total_citas || 0;
        historial.total_no_shows = historial.total_no_shows || 0;
        historial.pct_no_show_historico =
          parseFloat(historial.pct_no_show_historico) || 0.0;
        historial.dias_desde_ultima_cita =
          historial.dias_desde_ultima_cita || 0;

        console.log("Historial obtenido para paciente:", pacienteId, historial);
        resolve(historial);
      }
    });
  });
};

/**
 * Llamar al script Python - MEJORADO con mejor manejo de errores
 */
const callPythonPredictor = (citaData) => {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, "../../models/ml_predictions.py");

    console.log("=== LLAMANDO SCRIPT PYTHON ===");
    console.log("Script:", pythonScript);
    console.log("Datos enviados:", JSON.stringify(citaData, null, 2));

    const pythonCommand = process.platform === "win32" ? "python" : "python3";
    const pythonProcess = spawn(pythonCommand, [pythonScript]);

    let result = "";
    let error = "";

    pythonProcess.stdin.write(JSON.stringify(citaData));
    pythonProcess.stdin.end();

    pythonProcess.stdout.on("data", (data) => {
      result += data.toString();
    });

    pythonProcess.stderr.on("data", (data) => {
      error += data.toString();
      console.error("Python stderr:", data.toString());
    });

    pythonProcess.on("close", (code) => {
      console.log(`Proceso Python terminó con código: ${code}`);
      console.log("Resultado Python raw:", result);

      if (code !== 0) {
        console.error("Error Python completo:", error);
        reject(new Error(`Script Python falló (código ${code}): ${error}`));
      } else {
        try {
          const parsedResult = JSON.parse(result.trim());
          console.log("Resultado Python parseado:", parsedResult);
          resolve(parsedResult);
        } catch (parseError) {
          console.error("Error parseando resultado Python:", parseError);
          console.error("Resultado raw que falló:", result);
          reject(new Error(`Error parseando resultado: ${parseError.message}`));
        }
      }
    });

    pythonProcess.on("error", (spawnError) => {
      console.error("Error ejecutando Python:", spawnError);
      reject(new Error(`Error ejecutando Python: ${spawnError.message}`));
    });

    // Timeout aumentado y mejorado
    const timeout = setTimeout(() => {
      console.log("Timeout en predicción ML - matando proceso");
      pythonProcess.kill("SIGKILL");
      reject(new Error("Timeout en predicción ML (45s)"));
    }, 45000);

    pythonProcess.on("close", () => {
      clearTimeout(timeout);
    });
  });
};

/**
 * Formatear datos de cita para el modelo ML
 */
const formatearDatosCita = (citaData, historial) => {
  console.log("=== FORMATEANDO DATOS PARA ML ===");
  console.log("Cita original:", citaData);
  console.log("Historial:", historial);

  const datosMl = {
    // Identificadores
    cita_id: citaData.cita_id || citaData.id,
    paciente_id: citaData.paciente_id,

    // Fechas (formato ISO para Python)
    fecha_consulta: citaData.fecha_consulta,
    fecha_solicitud: citaData.fecha_solicitud || citaData.fecha_consulta,

    // Datos del paciente
    paciente_genero: citaData.paciente_genero || citaData.genero,
    paciente_fecha_nacimiento:
      citaData.paciente_fecha_nacimiento || citaData.fecha_nacimiento,
    paciente_alergias: citaData.paciente_alergias || citaData.alergias,

    // Datos de la cita
    categoria_servicio: citaData.categoria_servicio || "General",
    precio_servicio: parseFloat(citaData.precio_servicio || 600),
    duracion: parseInt(citaData.duracion || 30),
    estado_pago: citaData.estado_pago || "Pendiente",
    tratamiento_pendiente: citaData.tratamiento_pendiente ? 1 : 0,

    // Historial del paciente (sin data leakage)
    total_citas_historicas: historial.total_citas,
    total_no_shows_historicas: historial.total_no_shows,
    pct_no_show_historico: historial.pct_no_show_historico,
    dias_desde_ultima_cita: historial.dias_desde_ultima_cita,
  };

  console.log("Datos ML formateados:", datosMl);
  return datosMl;
};

/**
 * Endpoint principal para predicción de no-show - CORREGIDO
 */
router.post("/predict-no-show", async (req, res) => {
  try {
    const citaData = req.body;

    console.log("=== NUEVA PREDICCIÓN ML ===");
    console.log("Datos recibidos:", JSON.stringify(citaData, null, 2));

    if (!citaData || !citaData.fecha_consulta) {
      return res.status(400).json({
        success: false,
        error:
          "Datos de cita incompletos. Se requiere al menos fecha_consulta.",
      });
    }

    try {
      // Obtener historial SIN incluir la cita actual (evita data leakage)
      const citaId = citaData.cita_id || citaData.id;
      const historial = await getPacienteHistorial(
        citaData.paciente_id,
        citaId
      );

      console.log("Historial obtenido:", historial);

      // Formatear datos para el modelo ML
      const datosMl = formatearDatosCita(citaData, historial);

      // Llamar al modelo
      const prediccion = await callPythonPredictor(datosMl);

      if (prediccion.error) {
        console.error("Error en modelo ML:", prediccion.error);
        return res.status(500).json({
          success: false,
          error: `Error en modelo: ${prediccion.error}`,
        });
      }

      // Interpretar resultado (1 = No Show, 0 = Asistirá)
      const willNoShow = prediccion.prediction.will_no_show === 1;
      const probability = prediccion.prediction.probability || 0;

      console.log("=== PREDICCIÓN EXITOSA ===");
      console.log("Resultado binario:", prediccion.prediction.will_no_show);
      console.log("Probabilidad:", probability);
      console.log("Interpretación:", willNoShow ? "NO ASISTIRÁ" : "ASISTIRÁ");

      res.json({
        success: true,
        prediction: {
          will_no_show: willNoShow,
          prediction_binary: prediccion.prediction.will_no_show,
          probability: probability,
          risk_level: willNoShow ? "ALTO" : "BAJO",
          confidence:
            probability > 0.7 ? "ALTA" : probability > 0.4 ? "MEDIA" : "BAJA",
          mensaje: willNoShow
            ? `El modelo predice que este paciente probablemente NO asistirá (${(
                probability * 100
              ).toFixed(1)}% probabilidad)`
            : `El modelo predice que este paciente probablemente SÍ asistirá (${(
                (1 - probability) *
                100
              ).toFixed(1)}% probabilidad)`,
          features_debug: prediccion.prediction.features_used || null,
        },
        historial_paciente: {
          total_citas: historial.total_citas,
          total_no_shows: historial.total_no_shows,
          porcentaje_no_show:
            (historial.pct_no_show_historico * 100).toFixed(1) + "%",
          dias_ultima_cita: historial.dias_desde_ultima_cita,
        },
      });
    } catch (historialError) {
      console.error("Error obteniendo historial del paciente:", historialError);
      return res.status(500).json({
        success: false,
        error:
          "Error obteniendo historial del paciente: " + historialError.message,
      });
    }
  } catch (error) {
    console.error("Error general en predicción:", error);
    res.status(500).json({
      success: false,
      error: `Error interno del servidor: ${error.message}`,
    });
  }
});

/**
 * Endpoint para predicciones en lote - CORREGIDO
 */
router.post("/predict-batch", async (req, res) => {
  try {
    const { citas } = req.body;

    if (!Array.isArray(citas) || citas.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Se requiere un array de citas no vacío",
      });
    }

    console.log(`=== PREDICCIÓN BATCH: ${citas.length} citas ===`);

    const predicciones = [];

    for (let i = 0; i < citas.length; i++) {
      const cita = citas[i];
      console.log(
        `Procesando cita ${i + 1}/${citas.length} - ID: ${
          cita.id || cita.cita_id
        }`
      );

      try {
        if (!cita.paciente_id) {
          predicciones.push({
            cita_id: cita.cita_id || cita.id,
            success: false,
            prediction: null,
            error: "paciente_id requerido",
          });
          continue;
        }

        const citaId = cita.cita_id || cita.id;
        const historial = await getPacienteHistorial(cita.paciente_id, citaId);
        const datosMl = formatearDatosCita(cita, historial);
        const prediccion = await callPythonPredictor(datosMl);

        if (prediccion.error) {
          predicciones.push({
            cita_id: citaId,
            success: false,
            prediction: null,
            error: prediccion.error,
          });
        } else {
          const willNoShow = prediccion.prediction.will_no_show === 1;
          const probability = prediccion.prediction.probability || 0;

          predicciones.push({
            cita_id: citaId,
            success: true,
            prediction: {
              will_no_show: willNoShow,
              prediction_binary: prediccion.prediction.will_no_show,
              probability: probability,
              risk_level: willNoShow ? "ALTO" : "BAJO",
              confidence:
                probability > 0.7
                  ? "ALTA"
                  : probability > 0.4
                  ? "MEDIA"
                  : "BAJA",
            },
            error: null,
          });
        }

        // Pequeña pausa entre predicciones para no sobrecargar
        if (i < citas.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`Error procesando cita ${i + 1}:`, error);
        predicciones.push({
          cita_id: cita.cita_id || cita.id,
          success: false,
          prediction: null,
          error: error.message,
        });
      }
    }

    const successful = predicciones.filter((p) => p.success);
    const altoRiesgo = successful.filter(
      (p) => p.prediction.will_no_show
    ).length;

    console.log(`=== BATCH COMPLETADO ===`);
    console.log(
      `Total: ${predicciones.length}, Exitosas: ${successful.length}, Alto riesgo: ${altoRiesgo}`
    );

    res.json({
      success: true,
      predictions: predicciones,
      summary: {
        total: predicciones.length,
        successful: successful.length,
        failed: predicciones.filter((p) => !p.success).length,
        alto_riesgo: altoRiesgo,
        bajo_riesgo: successful.length - altoRiesgo,
        promedio_probabilidad:
          successful.length > 0
            ? (
                successful.reduce(
                  (sum, p) => sum + (p.prediction.probability || 0),
                  0
                ) / successful.length
              ).toFixed(3)
            : 0,
      },
    });
  } catch (error) {
    console.error("Error en predicción batch:", error);
    res.status(500).json({
      success: false,
      error: `Error interno del servidor: ${error.message}`,
    });
  }
});

/**
 * Endpoint de debug para probar features - NUEVO
 */
router.post("/debug-features", async (req, res) => {
  try {
    const citaData = req.body;

    if (!citaData.paciente_id) {
      return res.status(400).json({
        success: false,
        error: "Se requiere paciente_id para debug",
      });
    }

    const citaId = citaData.cita_id || citaData.id;
    const historial = await getPacienteHistorial(citaData.paciente_id, citaId);
    const datosMl = formatearDatosCita(citaData, historial);

    // Agregar flag de debug
    datosMl.debug = true;

    const debugResult = await callPythonPredictor(datosMl);

    res.json({
      success: true,
      debug_info: debugResult,
      datos_originales: citaData,
      historial_calculado: historial,
      datos_ml_formateados: datosMl,
    });
  } catch (error) {
    console.error("Error en debug:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Información del modelo y status - MEJORADO
 */
router.get("/model-info", (req, res) => {
  res.json({
    success: true,
    models: {
      no_show_predictor: {
        name: "No-Show Predictor RandomForest",
        type: "RandomForestClassifier",
        version: "1.0.1",
        output_type: "binary_classification_with_probability",
        classes: {
          0: "Asistirá a la cita",
          1: "No asistirá (No-Show)",
        },
        probability: "Devuelve probabilidad de no-show (0.0 a 1.0)",
        features: [
          "edad",
          "genero",
          "alergias_flag",
          "lead_time_days",
          "dow",
          "hour",
          "is_weekend",
          "categoria_servicio",
          "precio_servicio",
          "duration_min",
          "paid_flag",
          "tratamiento_pendiente",
          "total_citas",
          "total_no_shows",
          "pct_no_show_historico",
          "dias_desde_ultima_cita",
        ],
        available: true,
        description:
          "Modelo RandomForest para predecir inasistencias con protección contra data leakage",
      },
      patient_clustering: {
        name: "Patient Segmentation K-Means",
        type: "KMeans",
        version: "1.0.0",
        n_clusters: 3,
        segmentos: {
          0: "VIP - Clientes de alto valor",
          1: "REGULARES - Clientes con comportamiento estándar",
          2: "PROBLEMÁTICOS - Clientes que requieren atención especial",
        },
        features: [
          "gasto_total_citas",
          "ticket_promedio",
          "precio_maximo",
          "citas_canceladas",
          "tratamientos_activos",
          "citas_pendientes_pago",
          "valor_tratamiento_promedio",
          "tasa_noshow",
        ],
        preprocessing: "StandardScaler + Log transformation",
        available: true,
        description:
          "Modelo K-Means para segmentación de pacientes basado en comportamiento",
      },
    },
    endpoints: {
      // No-Show Prediction
      predict_no_show: "POST /api/ml/predict-no-show",
      predict_batch: "POST /api/ml/predict-batch",
      debug_features: "POST /api/ml/debug-features",

      // Patient Clustering
      classify_patient: "POST /api/ml/classify-patient/:id",
      classify_batch: "POST /api/ml/classify-patients-batch",
      segmentation_stats: "GET /api/ml/segmentation-stats",
      clustering_model_info: "GET /api/ml/clustering-model-info",

      // General
      model_info: "GET /api/ml/model-info",
      health: "GET /api/ml/health",
      cita_detalles: "GET /api/ml/cita-detalles/:citaId",
    },
  });
});

/**
 * Endpoint de salud - MEJORADO
 */
router.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    message: "ML Predictions service running correctly",
    model_type: "binary_classification_with_probability",
    version: "1.0.1",
  });
});

/**
 * Obtener detalles completos de una cita para análisis de predicción
 */
router.get("/cita-detalles/:citaId", async (req, res) => {
  try {
    const { citaId } = req.params;

    console.log(`=== OBTENIENDO DETALLES DE CITA ${citaId} ===`);

    if (!citaId) {
      return res.status(400).json({
        success: false,
        error: "ID de cita requerido",
      });
    }

    const query = `
      SELECT 
        c.*,
        CASE 
          WHEN c.paciente_id IS NOT NULL THEN p.nombre 
          ELSE c.nombre 
        END as nombre_paciente,
        CASE 
          WHEN c.paciente_id IS NOT NULL THEN p.aPaterno 
          ELSE c.apellido_paterno 
        END as apellido_paterno_final,
        CASE 
          WHEN c.paciente_id IS NOT NULL THEN p.aMaterno 
          ELSE c.apellido_materno 
        END as apellido_materno_final,
        CASE 
          WHEN c.paciente_id IS NOT NULL THEN p.genero 
          ELSE c.genero 
        END as genero_paciente,
        CASE 
          WHEN c.paciente_id IS NOT NULL THEN p.fechaNacimiento 
          ELSE NULL 
        END as fecha_nacimiento,
        CASE 
          WHEN c.paciente_id IS NOT NULL THEN p.email 
          ELSE c.correo 
        END as email_paciente,
        CASE 
          WHEN c.paciente_id IS NOT NULL THEN p.telefono 
          ELSE c.telefono 
        END as telefono_paciente,
        p.alergias,
        p.condiciones_medicas,
        
        CASE 
          WHEN c.paciente_id IS NOT NULL THEN (
            SELECT COUNT(*) FROM citas 
            WHERE paciente_id = c.paciente_id 
            AND fecha_consulta < NOW() 
            AND archivado = 0
          )
          ELSE 0 
        END as total_citas_historicas,
        
        CASE 
          WHEN c.paciente_id IS NOT NULL THEN (
            SELECT COUNT(*) FROM citas 
            WHERE paciente_id = c.paciente_id 
            AND estado IN ('Cancelada', 'No llegó') 
            AND fecha_consulta < NOW() 
            AND archivado = 0
          )
          ELSE 0 
        END as total_no_shows_historicas,
        
        CASE 
          WHEN c.paciente_id IS NOT NULL THEN (
            SELECT COALESCE(
              COUNT(CASE WHEN estado IN ('Cancelada', 'No llegó') THEN 1 END) / NULLIF(COUNT(*), 0), 
              0
            ) FROM citas 
            WHERE paciente_id = c.paciente_id 
            AND fecha_consulta < NOW() 
            AND archivado = 0
          )
          ELSE 0.0 
        END as pct_no_show_historico,
        
        CASE 
          WHEN c.paciente_id IS NOT NULL THEN (
            SELECT COALESCE(
              DATEDIFF(NOW(), MAX(CASE WHEN estado = 'Completada' THEN fecha_consulta END)),
              0
            ) FROM citas 
            WHERE paciente_id = c.paciente_id 
            AND fecha_consulta < NOW() 
            AND archivado = 0
          )
          ELSE 0 
        END as dias_desde_ultima_cita
        
      FROM citas c
      LEFT JOIN pacientes p ON c.paciente_id = p.id
      WHERE c.id = ?
    `;

    db.query(query, [citaId], (err, results) => {
      if (err) {
        console.error("Error en query de detalles:", err);
        return res.status(500).json({
          success: false,
          error: "Error obteniendo detalles de la cita",
        });
      }

      if (results.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Cita no encontrada",
        });
      }

      const citaDetalles = results[0];
      const esRegistrado = citaDetalles.paciente_id !== null;

      const response = {
        success: true,
        detalles: {
          cita_id: citaDetalles.id,
          fecha_consulta: citaDetalles.fecha_consulta,
          fecha_solicitud: citaDetalles.fecha_solicitud,
          estado: citaDetalles.estado,
          notas: citaDetalles.notas,

          paciente_id: citaDetalles.paciente_id,
          es_paciente_registrado: esRegistrado,
          nombre: citaDetalles.nombre_paciente,
          apellido_paterno: citaDetalles.apellido_paterno_final,
          apellido_materno: citaDetalles.apellido_materno_final,
          nombre_completo: `${citaDetalles.nombre_paciente || ""} ${
            citaDetalles.apellido_paterno_final || ""
          } ${citaDetalles.apellido_materno_final || ""}`.trim(),
          genero: citaDetalles.genero_paciente,
          fecha_nacimiento: citaDetalles.fecha_nacimiento,
          edad: citaDetalles.fecha_nacimiento
            ? Math.floor(
                (Date.now() -
                  new Date(citaDetalles.fecha_nacimiento).getTime()) /
                  (365.25 * 24 * 60 * 60 * 1000)
              )
            : null,
          correo: citaDetalles.email_paciente,
          telefono: citaDetalles.telefono_paciente,
          alergias: citaDetalles.alergias,
          condiciones_medicas: citaDetalles.condiciones_medicas,

          servicio_nombre: citaDetalles.servicio_nombre,
          categoria_servicio: citaDetalles.categoria_servicio,
          precio_servicio: citaDetalles.precio_servicio,
          duracion: citaDetalles.duracion || 30,

          odontologo_nombre: citaDetalles.odontologo_nombre,

          total_citas_historicas: citaDetalles.total_citas_historicas || 0,
          total_no_shows_historicas:
            citaDetalles.total_no_shows_historicas || 0,
          pct_no_show_historico:
            parseFloat(citaDetalles.pct_no_show_historico) || 0.0,
          dias_desde_ultima_cita: citaDetalles.dias_desde_ultima_cita || 0,

          estado_pago: citaDetalles.estado_pago,
          metodo_pago: citaDetalles.metodo_pago,

          lead_time_days:
            citaDetalles.fecha_consulta && citaDetalles.fecha_solicitud
              ? Math.floor(
                  (new Date(citaDetalles.fecha_consulta) -
                    new Date(citaDetalles.fecha_solicitud)) /
                    (1000 * 60 * 60 * 24)
                )
              : 0,
          dia_semana: citaDetalles.fecha_consulta
            ? new Date(citaDetalles.fecha_consulta).toLocaleDateString(
                "es-ES",
                {
                  weekday: "long",
                }
              )
            : null,
          hora_cita: citaDetalles.fecha_consulta
            ? new Date(citaDetalles.fecha_consulta).getHours()
            : null,
          es_fin_semana: citaDetalles.fecha_consulta
            ? [0, 6].includes(new Date(citaDetalles.fecha_consulta).getDay())
            : false,

          factores_riesgo: [],
        },
      };

      // Calcular factores de riesgo
      const factores = [];

      if (response.detalles.lead_time_days > 30) {
        factores.push({
          factor: "Cita programada con mucha anticipación",
          valor: `${response.detalles.lead_time_days} días`,
          impacto: "Alto",
        });
      }

      if (!esRegistrado) {
        factores.push({
          factor: "Paciente no registrado",
          valor: "Sin historial",
          impacto: "Alto",
          descripcion:
            "Los pacientes no registrados tienen mayor riesgo de inasistencia",
        });
      } else if (response.detalles.pct_no_show_historico > 0.2) {
        factores.push({
          factor: "Historial de inasistencias",
          valor: `${(response.detalles.pct_no_show_historico * 100).toFixed(
            1
          )}%`,
          impacto:
            response.detalles.pct_no_show_historico > 0.4 ? "Alto" : "Medio",
        });
      }

      if (response.detalles.estado_pago === "Pendiente") {
        factores.push({
          factor: "Pago pendiente",
          valor: "No pagado",
          impacto: "Alto",
        });
      }

      response.detalles.factores_riesgo = factores;

      console.log(`Detalles obtenidos para cita ${citaId}:`, {
        paciente: response.detalles.nombre_completo,
        registrado: esRegistrado,
        factores: factores.length,
      });

      res.json(response);
    });
  } catch (error) {
    console.error("Error general en cita-detalles:", error);
    res.status(500).json({
      success: false,
      error: `Error interno del servidor: ${error.message}`,
    });
  }
});

/**
 * Endpoint para obtener estadísticas de predicciones
 */
router.get("/estadisticas-predicciones", async (req, res) => {
  try {
    const { periodo = "mes" } = req.query;

    let fechaInicio;
    const ahora = new Date();

    switch (periodo) {
      case "hoy":
        fechaInicio = new Date(
          ahora.getFullYear(),
          ahora.getMonth(),
          ahora.getDate()
        );
        break;
      case "semana":
        fechaInicio = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "mes":
      default:
        fechaInicio = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
        break;
    }

    const statsQuery = `
      SELECT 
        COUNT(*) as total_citas,
        COUNT(CASE WHEN estado NOT IN ('Completada', 'Cancelada') THEN 1 END) as citas_activas,
        COUNT(CASE WHEN estado = 'Completada' THEN 1 END) as citas_completadas,
        COUNT(CASE WHEN estado = 'Cancelada' THEN 1 END) as citas_canceladas,
        AVG(precio_servicio) as precio_promedio
      FROM citas 
      WHERE fecha_consulta >= ? 
      AND archivado = 0
    `;

    db.query(statsQuery, [fechaInicio], (err, results) => {
      if (err) {
        console.error("Error obteniendo estadísticas:", err);
        return res.status(500).json({
          success: false,
          error: "Error obteniendo estadísticas",
        });
      }

      const stats = results[0];

      res.json({
        success: true,
        periodo,
        estadisticas: {
          total_citas: stats.total_citas,
          citas_activas: stats.citas_activas,
          citas_completadas: stats.citas_completadas,
          citas_canceladas: stats.citas_canceladas,
          precio_promedio: parseFloat(stats.precio_promedio) || 0,
          tasa_completacion:
            stats.total_citas > 0
              ? ((stats.citas_completadas / stats.total_citas) * 100).toFixed(1)
              : 0,
          tasa_cancelacion:
            stats.total_citas > 0
              ? ((stats.citas_canceladas / stats.total_citas) * 100).toFixed(1)
              : 0,
        },
      });
    });
  } catch (error) {
    console.error("Error en estadísticas-predicciones:", error);
    res.status(500).json({
      success: false,
      error: `Error interno del servidor: ${error.message}`,
    });
  }
});

/**
 * Endpoint para enviar recordatorio de cita por email
 */
router.post("/send-reminder", async (req, res) => {
  try {
    const { paciente_id, email, mensaje, cita_id } = req.body;

    console.log(`=== ENVIANDO RECORDATORIO DE ALTO RIESGO ===`);
    console.log("Datos recibidos:", { paciente_id, email, cita_id });

    if (!paciente_id || !email || !mensaje || !cita_id) {
      return res.status(400).json({
        success: false,
        error: "Datos incompletos para envío de recordatorio",
      });
    }

    const citaQuery = `
      SELECT 
        c.*,
        p.nombre,
        p.aPaterno as apellido_paterno,    
        p.aMaterno as apellido_materno,     
        s.title as servicio_nombre
      FROM citas c
      LEFT JOIN pacientes p ON c.paciente_id = p.id
      LEFT JOIN servicios s ON c.servicio_id = s.id
      WHERE c.id = ?                      
    `;

    db.query(citaQuery, [cita_id], async (err, results) => {
      if (err) {
        console.error("Error obteniendo datos de la cita:", err);
        return res.status(500).json({
          success: false,
          error: "Error obteniendo información de la cita",
        });
      }

      if (results.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Cita no encontrada",
        });
      }

      const citaInfo = results[0];
      const nombreCompleto = `${citaInfo.nombre} ${
        citaInfo.apellido_paterno || ""
      } ${citaInfo.apellido_materno || ""}`.trim();
      const fechaCita = new Date(citaInfo.fecha_consulta);
      const fechaFormateada = fechaCita.toLocaleDateString("es-ES", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const horaFormateada = fechaCita.toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      });

      const mailOptions = {
        from: '"Odontología Carol" <sistema@odontologiacarol.com>',
        to: email,
        subject: "Recordatorio Importante de Cita - Odontología Carol",
        html: `
          <div style="font-family: 'Roboto', Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; background-color: #fafafa;">
              <div style="background-color: #d32f2f; padding: 20px; text-align: center; border-radius: 4px 4px 0 0;">
                  <h1 style="color: white; margin: 0; font-weight: 500; font-size: 22px;">Odontología Carol</h1>
                  <p style="color: white; margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Recordatorio Importante de Cita</p>
              </div>
              
              <div style="padding: 30px 40px; background-color: white; box-shadow: 0 2px 5px rgba(0,0,0,0.1); border-radius: 0 0 4px 4px;">
                  <p style="font-size: 16px; margin: 0 0 20px;">¡Hola <b>${nombreCompleto}</b>!</p>
                  
                  <div style="margin: 25px 0; padding: 20px; background-color: #ffebee; border-left: 4px solid #d32f2f; border-radius: 4px;">
                      <h3 style="color: #d32f2f; font-weight: 500; font-size: 16px; margin: 0 0 10px;">
                          Confirmación Requerida - Alto Riesgo de Inasistencia
                      </h3>
                      <p style="color: #c62828; font-size: 14px; margin: 0; line-height: 1.4;">
                          Nuestro sistema de inteligencia artificial ha detectado un <b>alto riesgo de inasistencia</b> para tu próxima cita. 
                          <b>Por favor confirma tu asistencia</b> para evitar la cancelación automática.
                      </p>
                  </div>

                  <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                      <h3 style="margin: 0 0 15px; color: #1976d2; font-size: 18px;">Detalles de tu Cita</h3>
                      <table style="width: 100%; border-collapse: collapse;">
                          <tr>
                              <td style="padding: 8px 0; font-weight: 500; color: #555; width: 120px;">Fecha:</td>
                              <td style="padding: 8px 0; color: #333;">${fechaFormateada}</td>
                          </tr>
                          <tr>
                              <td style="padding: 8px 0; font-weight: 500; color: #555;">Hora:</td>
                              <td style="padding: 8px 0; color: #333;">${horaFormateada}</td>
                          </tr>
                          <tr>
                              <td style="padding: 8px 0; font-weight: 500; color: #555;">Servicio:</td>
                              <td style="padding: 8px 0; color: #333;">${
                                citaInfo.servicio_nombre || "Consulta General"
                              }</td>
                          </tr>
                      </table>
                  </div>

                  <div style="background-color: #fff3e0; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #ffcc02;">
                      <h4 style="margin: 0 0 10px; color: #ef6c00; font-size: 16px;">Mensaje Personal</h4>
                      <p style="font-size: 15px; margin: 0; line-height: 1.6; color: #333; white-space: pre-line;">${mensaje}</p>
                  </div>

                  <div style="text-align: center; margin: 30px 0;">
                      <a href="tel:+525512345678" style="display: inline-block; background-color: #1976d2; color: white; padding: 12px 25px; text-decoration: none; border-radius: 25px; font-weight: 500; margin: 0 10px 10px 0;">
                          Llamar para Confirmar
                      </a>
                      <a href="https://wa.me/525512345678" style="display: inline-block; background-color: #25d366; color: white; padding: 12px 25px; text-decoration: none; border-radius: 25px; font-weight: 500; margin: 0 10px 10px 0;">
                          WhatsApp
                      </a>
                  </div>

                  <div style="margin: 25px 0; padding: 15px; background-color: #e8f5e9; border-left: 4px solid #2e7d32; border-radius: 4px;">
                      <p style="color: #2e7d32; font-weight: 500; font-size: 14px; margin: 0; line-height: 1.4;">
                          <b>¿Por qué es importante confirmar?</b><br>
                          • Mantenemos tu espacio reservado<br>
                          • Evitamos cancelaciones automáticas<br>
                          • Garantizamos la mejor atención para ti
                      </p>
                  </div>

                  <div style="margin: 25px 0; padding: 15px; background-color: #fff8e1; border-left: 4px solid #ffa000; border-radius: 4px;">
                      <p style="color: #e65100; font-weight: 500; font-size: 14px; margin: 0; line-height: 1.4;">
                          <b>Política de Cancelación:</b><br>
                          Si no confirmas tu asistencia en las próximas 24 horas, tu cita podría ser reasignada automáticamente a otros pacientes en lista de espera.
                      </p>
                  </div>
                  
                  <p style="font-size: 15px; color: #555; margin: 20px 0; text-align: center;">
                      Gracias por elegirnos para cuidar de tu salud bucal
                  </p>
              </div>
              
              <div style="text-align: center; padding: 20px; color: #757575; font-size: 13px; border-top: 1px solid #eaeaea;">
                  <p style="margin: 0 0 5px;">Odontología Carol - Cuidando de tu salud bucal</p>
                  <p style="margin: 0; color: #9e9e9e;">Dirección del consultorio | Tel: (55) 1234-5678</p>
                  <p style="margin: 5px 0 0 0; color: #9e9e9e; font-size: 11px;">Este es un correo generado automáticamente por nuestro sistema de predicción de asistencia.</p>
              </div>
          </div>
        `,
      };

      try {
        const info = await transporter.sendMail(mailOptions);
        console.log("Recordatorio enviado exitosamente:", info.messageId);

        const updateNotasQuery = `
          UPDATE citas 
          SET notas = CONCAT(COALESCE(notas, ''), '\n[RECORDATORIO ENVIADO] ', NOW(), ' - Email alto riesgo enviado a ${email}')
          WHERE id = ?
        `;

        db.query(updateNotasQuery, [cita_id], (updateErr) => {
          if (updateErr) {
            console.error("Error actualizando notas de la cita:", updateErr);
          } else {
            console.log("Recordatorio registrado en notas de la cita");
          }
        });

        res.json({
          success: true,
          message: "Recordatorio enviado exitosamente",
          data: {
            cita_id,
            paciente: nombreCompleto,
            email,
            fecha_envio: new Date().toISOString(),
            tipo: "prediccion_alto_riesgo",
            message_id: info.messageId,
          },
        });
      } catch (emailError) {
        console.error("Error enviando email:", emailError);
        res.status(500).json({
          success: false,
          error: `Error enviando email: ${emailError.message}`,
        });
      }
    });
  } catch (error) {
    console.error("Error general enviando recordatorio:", error);
    res.status(500).json({
      success: false,
      error: `Error interno del servidor: ${error.message}`,
    });
  }
});

/**
 * Ejecuta el script de Python para clasificación de pacientes (clustering)
 */
const executePatientClassification = (patientData) => {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "../../models/classify_patient.py");

    console.log("=== LLAMANDO CLUSTERING SCRIPT ===");
    console.log("Script:", scriptPath);
    console.log("Datos enviados:", JSON.stringify(patientData, null, 2));

    const pythonCommand = process.platform === "win32" ? "python" : "python3";
    const pythonProcess = spawn(pythonCommand, [
      scriptPath,
      JSON.stringify(patientData),
    ]);

    let result = "";
    let error = "";

    pythonProcess.stdout.on("data", (data) => {
      result += data.toString();
    });

    pythonProcess.stderr.on("data", (data) => {
      error += data.toString();
      console.error("Python clustering stderr:", data.toString());
    });

    pythonProcess.on("close", (code) => {
      console.log(`Proceso Python clustering terminó con código: ${code}`);
      console.log("Resultado clustering raw:", result);

      if (code !== 0) {
        console.error("Error Python clustering completo:", error);
        reject(
          new Error(`Script Python clustering falló (código ${code}): ${error}`)
        );
      } else {
        try {
          const parsedResult = JSON.parse(result.trim());
          console.log("Resultado clustering parseado:", parsedResult);
          resolve(parsedResult);
        } catch (parseError) {
          console.error("Error parseando resultado clustering:", parseError);
          reject(
            new Error(
              `Error parseando resultado clustering: ${parseError.message}`
            )
          );
        }
      }
    });

    pythonProcess.on("error", (spawnError) => {
      console.error("Error ejecutando Python clustering:", spawnError);
      reject(
        new Error(`Error ejecutando Python clustering: ${spawnError.message}`)
      );
    });

    // Timeout para clustering
    const timeout = setTimeout(() => {
      console.log("Timeout en clustering - matando proceso");
      pythonProcess.kill("SIGKILL");
      reject(new Error("Timeout en clustering (30s)"));
    }, 30000);

    pythonProcess.on("close", () => {
      clearTimeout(timeout);
    });
  });
};

/**
 * Obtiene datos del paciente para clustering usando las variables CORRECTAS del modelo original
 */
const getPatientDataForClustering = async (patientId) => {
  return new Promise((resolve, reject) => {
    // Query corregida para calcular las métricas exactas del modelo entrenado
    const query = `
      SELECT 
        p.id as paciente_id,
        p.nombre,
        p.aPaterno,
        p.aMaterno,
        
        -- METRIC 1: tasa_noshow (citas no asistidas / total citas)
        COALESCE(
          COUNT(CASE WHEN c.estado IN ('Cancelada', 'No llegó') THEN 1 END) / NULLIF(COUNT(c.id), 0), 
          0.0
        ) as tasa_noshow,
        
        -- METRIC 2: tasa_completion (citas completadas / total citas)
        COALESCE(
          COUNT(CASE WHEN c.estado = 'Completada' THEN 1 END) / NULLIF(COUNT(c.id), 0), 
          0.0
        ) as tasa_completion,
        
        -- METRIC 3: citas_canceladas (número absoluto)
        COUNT(CASE WHEN c.estado = 'Cancelada' THEN 1 END) as citas_canceladas,
        
        -- METRIC 4: tasa_pago_exitoso (pagos completados / total citas con precio)
        COALESCE(
          COUNT(CASE WHEN c.estado_pago = 'Completado' THEN 1 END) / 
          NULLIF(COUNT(CASE WHEN c.precio_servicio > 0 THEN 1 END), 0), 
          0.0
        ) as tasa_pago_exitoso,
        
        -- Datos adicionales para debug
        COUNT(c.id) as total_citas,
        COUNT(CASE WHEN c.estado = 'Completada' THEN 1 END) as citas_completadas,
        COUNT(CASE WHEN c.estado_pago = 'Completado' THEN 1 END) as pagos_completados,
        COUNT(CASE WHEN c.precio_servicio > 0 THEN 1 END) as citas_con_precio
        
      FROM pacientes p
      LEFT JOIN citas c ON p.id = c.paciente_id AND c.archivado = 0
      WHERE p.id = ?
      GROUP BY p.id, p.nombre, p.aPaterno, p.aMaterno
    `;

    console.log("Query clustering corregida:", query);
    console.log("Parámetro paciente_id:", patientId);

    db.query(query, [patientId], (err, results) => {
      if (err) {
        console.error("Error en query clustering:", err);
        reject(new Error(`Error obteniendo datos del paciente: ${err.message}`));
      } else if (results.length === 0) {
        reject(new Error("Paciente no encontrado"));
      } else {
        const result = results[0];
        
        // Convertir y validar tipos de datos
        const convertedResult = {
          paciente_id: parseInt(result.paciente_id),
          nombre: result.nombre,
          aPaterno: result.aPaterno,
          aMaterno: result.aMaterno,
          
          // Las 4 métricas exactas del modelo entrenado
          tasa_noshow: parseFloat(result.tasa_noshow) || 0.0,
          tasa_completion: parseFloat(result.tasa_completion) || 0.0,
          citas_canceladas: parseInt(result.citas_canceladas) || 0,
          tasa_pago_exitoso: parseFloat(result.tasa_pago_exitoso) || 0.0,
          
          // Debug info
          total_citas: parseInt(result.total_citas) || 0,
          citas_completadas: parseInt(result.citas_completadas) || 0,
          pagos_completados: parseInt(result.pagos_completados) || 0,
          citas_con_precio: parseInt(result.citas_con_precio) || 0
        };

        console.log("DEBUG: Datos clustering calculados:", convertedResult);
        
        // Validaciones de sanidad
        if (convertedResult.tasa_noshow > 1.0 || convertedResult.tasa_noshow < 0.0) {
          console.warn(`Tasa noshow fuera de rango: ${convertedResult.tasa_noshow}`);
          convertedResult.tasa_noshow = Math.max(0.0, Math.min(1.0, convertedResult.tasa_noshow));
        }
        
        if (convertedResult.tasa_completion > 1.0 || convertedResult.tasa_completion < 0.0) {
          console.warn(`Tasa completion fuera de rango: ${convertedResult.tasa_completion}`);
          convertedResult.tasa_completion = Math.max(0.0, Math.min(1.0, convertedResult.tasa_completion));
        }
        
        if (convertedResult.tasa_pago_exitoso > 1.0 || convertedResult.tasa_pago_exitoso < 0.0) {
          console.warn(`Tasa pago fuera de rango: ${convertedResult.tasa_pago_exitoso}`);
          convertedResult.tasa_pago_exitoso = Math.max(0.0, Math.min(1.0, convertedResult.tasa_pago_exitoso));
        }

        resolve(convertedResult);
      }
    });
  });
};


/**
 * ENDPOINT CORREGIDO: Clasificar un paciente específico
 */
router.post("/classify-patient/:id", async (req, res) => {
  try {
    const patientId = parseInt(req.params.id);

    console.log(`=== CLASIFICACIÓN CLUSTERING PACIENTE ${patientId} ===`);

    if (!patientId || isNaN(patientId)) {
      return res.status(400).json({
        success: false,
        error: "ID de paciente inválido",
      });
    }

    // Obtener datos con las métricas correctas
    const patientData = await getPatientDataForClustering(patientId);
    console.log("Datos para clustering:", patientData);

    // Preparar datos para el script Python (solo las 4 variables del modelo)
    const clusteringInput = {
      paciente_id: patientData.paciente_id,
      tasa_noshow: patientData.tasa_noshow,
      tasa_completion: patientData.tasa_completion,
      citas_canceladas: patientData.citas_canceladas,
      tasa_pago_exitoso: patientData.tasa_pago_exitoso
    };

    // Ejecutar clasificación
    const classificationResult = await executePatientClassification(clusteringInput);

    if (classificationResult.success) {
      console.log("=== CLASIFICACIÓN EXITOSA ===");
      console.log("Segmento:", classificationResult.segmento);
      console.log("Cluster:", classificationResult.cluster);

      res.json({
        success: true,
        data: {
          patient_id: patientId,
          nombre: `${patientData.nombre} ${patientData.aPaterno || ""} ${
            patientData.aMaterno || ""
          }`.trim(),
          cluster: classificationResult.cluster,
          segmento: classificationResult.segmento,
          confidence: classificationResult.confidence,
          metricas_utilizadas: {
            tasa_noshow: patientData.tasa_noshow,
            tasa_completion: patientData.tasa_completion,
            citas_canceladas: patientData.citas_canceladas,
            tasa_pago_exitoso: patientData.tasa_pago_exitoso
          },
          datos_contexto: {
            total_citas: patientData.total_citas,
            citas_completadas: patientData.citas_completadas,
            pagos_completados: patientData.pagos_completados,
            interpretacion: {
              comportamiento_asistencia: patientData.tasa_noshow < 0.2 ? "Muy bueno" : 
                                       patientData.tasa_noshow < 0.4 ? "Regular" : "Problemático",
              completacion_tratamientos: patientData.tasa_completion > 0.8 ? "Excelente" :
                                        patientData.tasa_completion > 0.6 ? "Bueno" : "Necesita seguimiento",
              historial_pagos: patientData.tasa_pago_exitoso > 0.8 ? "Excelente" :
                              patientData.tasa_pago_exitoso > 0.6 ? "Bueno" : "Problemático"
            }
          }
        },
      });
    } else {
      res.status(500).json({
        success: false,
        error: "Error en la clasificación de paciente",
        details: classificationResult.error,
      });
    }
  } catch (error) {
    console.error("Error en classify-patient:", error);
    res.status(500).json({
      success: false,
      error: `Error interno del servidor: ${error.message}`,
    });
  }
});
/**
 * NUEVO ENDPOINT: Clasificar múltiples pacientes (batch clustering)
 */
router.post("/classify-patients-batch", async (req, res) => {
  try {
    const { patient_ids } = req.body;

    if (!Array.isArray(patient_ids) || patient_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Se requiere un array de IDs de pacientes",
      });
    }

    console.log(`=== CLASIFICACIÓN BATCH: ${patient_ids.length} pacientes ===`);

    const results = [];

    for (let i = 0; i < patient_ids.length; i++) {
      const patientId = patient_ids[i];
      console.log(
        `Procesando paciente ${i + 1}/${patient_ids.length} - ID: ${patientId}`
      );

      try {
        const patientData = await getPatientDataForClustering(patientId);
        const classificationResult = await executePatientClassification(
          patientData
        );

        if (classificationResult.success) {
          results.push({
            patient_id: patientId,
            nombre: `${patientData.nombre} ${patientData.aPaterno || ""} ${
              patientData.aMaterno || ""
            }`.trim(),
            success: true,
            cluster: classificationResult.cluster,
            segmento: classificationResult.segmento,
            confidence: classificationResult.confidence,
          });
        } else {
          results.push({
            patient_id: patientId,
            success: false,
            error: classificationResult.error,
          });
        }

        // Pausa entre clasificaciones
        if (i < patient_ids.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      } catch (error) {
        console.error(`Error procesando paciente ${patientId}:`, error);
        results.push({
          patient_id: patientId,
          success: false,
          error: error.message,
        });
      }
    }

    const successful = results.filter((r) => r.success);
    const vipCount = successful.filter((r) => r.segmento === "VIP").length;
    const regularesCount = successful.filter(
      (r) => r.segmento === "REGULARES"
    ).length;
    const problematicosCount = successful.filter(
      (r) => r.segmento === "PROBLEMÁTICOS"
    ).length;

    console.log("=== BATCH CLUSTERING COMPLETADO ===");
    console.log(`Total: ${results.length}, Exitosos: ${successful.length}`);
    console.log(
      `VIP: ${vipCount}, Regulares: ${regularesCount}, Problemáticos: ${problematicosCount}`
    );

    res.json({
      success: true,
      results: results,
      summary: {
        total: results.length,
        successful: successful.length,
        failed: results.filter((r) => !r.success).length,
        segmentos: {
          vip: vipCount,
          regulares: regularesCount,
          problematicos: problematicosCount,
        },
      },
    });
  } catch (error) {
    console.error("Error en classify-patients-batch:", error);
    res.status(500).json({
      success: false,
      error: `Error interno del servidor: ${error.message}`,
    });
  }
});

/**
 * NUEVO ENDPOINT: Obtener estadísticas de segmentación
 */
router.get("/segmentation-stats", async (req, res) => {
  try {
    console.log("=== OBTENIENDO ESTADÍSTICAS DE SEGMENTACIÓN ===");

    // Query para obtener estadísticas básicas de pacientes
    const statsQuery = `
      SELECT 
        COUNT(*) as total_pacientes,
        COUNT(CASE WHEN p.estado = 'Activo' THEN 1 END) as pacientes_activos,
        AVG(CASE WHEN c.precio_servicio > 0 THEN c.precio_servicio END) as ticket_promedio_general,
        SUM(c.precio_servicio) as ingresos_totales,
        COUNT(DISTINCT c.id) as total_citas
      FROM pacientes p
      LEFT JOIN citas c ON p.id = c.paciente_id AND c.archivado = 0
      WHERE p.estado != 'Eliminado'
    `;

    db.query(statsQuery, [], (err, results) => {
      if (err) {
        console.error("Error obteniendo estadísticas:", err);
        return res.status(500).json({
          success: false,
          error: "Error obteniendo estadísticas de segmentación",
        });
      }

      const stats = results[0];

      res.json({
        success: true,
        estadisticas: {
          total_pacientes: stats.total_pacientes || 0,
          pacientes_activos: stats.pacientes_activos || 0,
          ticket_promedio_general:
            parseFloat(stats.ticket_promedio_general) || 0,
          ingresos_totales: parseFloat(stats.ingresos_totales) || 0,
          total_citas: stats.total_citas || 0,
          // Estas se actualizarían conforme se vayan clasificando pacientes
          segmentos_estimados: {
            vip: "Por clasificar",
            regulares: "Por clasificar",
            problematicos: "Por clasificar",
          },
        },
        mensaje:
          "Usa los endpoints de clasificación para obtener segmentación específica",
      });
    });
  } catch (error) {
    console.error("Error en segmentation-stats:", error);
    res.status(500).json({
      success: false,
      error: `Error interno del servidor: ${error.message}`,
    });
  }
});

/**
 * NUEVO ENDPOINT: Información del modelo de clustering
 */
router.get("/clustering-model-info", (req, res) => {
  res.json({
    success: true,
    model_info: {
      name: "Patient Segmentation K-Means Clustering",
      type: "KMeans",
      version: "1.0.0",
      n_clusters: 3,
      segmentos: {
        0: "VIP - Clientes de alto valor",
        1: "REGULARES - Clientes con comportamiento estándar",
        2: "PROBLEMÁTICOS - Clientes que requieren atención especial",
      },
      features_utilizadas: [
        "gasto_total_citas",
        "ticket_promedio",
        "precio_maximo",
        "citas_canceladas",
        "tratamientos_activos",
        "citas_pendientes_pago",
        "valor_tratamiento_promedio",
        "tasa_noshow",
      ],
      preprocessing: "StandardScaler + Log transformation",
      available: true,
      description:
        "Modelo K-Means para segmentación de pacientes basado en comportamiento financiero y asistencia",
    },
    endpoints: {
      classify_single: "POST /api/ml/classify-patient/:id",
      classify_batch: "POST /api/ml/classify-patients-batch",
      segmentation_stats: "GET /api/ml/segmentation-stats",
      clustering_model_info: "GET /api/ml/clustering-model-info",
    },
  });
});

/**
 * ENDPOINT CORREGIDO: Segmentación dinámica de pacientes
 */
router.post("/patients-segmentation", async (req, res) => {
  try {
    const {
      edad_min = 0,
      edad_max = 100,
      ubicaciones = [],
      servicios = [],
      total_citas_min = 0,
      limit = 50, // Reducido para evitar timeouts
      search = "",
    } = req.body;

    console.log("=== SEGMENTACIÓN DINÁMICA CORREGIDA ===");

    // Query corregida con las métricas correctas
    const query = `
      SELECT 
        p.id as paciente_id,
        p.nombre,
        p.aPaterno,
        p.aMaterno,
        CONCAT(p.nombre, ' ', p.aPaterno, ' ', COALESCE(p.aMaterno, '')) as nombre_completo,
        p.fechaNacimiento,
        TIMESTAMPDIFF(YEAR, p.fechaNacimiento, CURDATE()) as edad,
        p.genero,
        p.lugar,
        p.telefono,
        p.email,
        p.estado as estado_paciente,
        
        -- Métricas para clustering (las 4 correctas)
        COUNT(c.id) as total_citas,
        COALESCE(
          COUNT(CASE WHEN c.estado IN ('Cancelada', 'No llegó') THEN 1 END) / NULLIF(COUNT(c.id), 0), 
          0.0
        ) as tasa_noshow,
        COALESCE(
          COUNT(CASE WHEN c.estado = 'Completada' THEN 1 END) / NULLIF(COUNT(c.id), 0), 
          0.0
        ) as tasa_completion,
        COUNT(CASE WHEN c.estado = 'Cancelada' THEN 1 END) as citas_canceladas,
        COALESCE(
          COUNT(CASE WHEN c.estado_pago = 'Completado' THEN 1 END) / 
          NULLIF(COUNT(CASE WHEN c.precio_servicio > 0 THEN 1 END), 0), 
          0.0
        ) as tasa_pago_exitoso,
        
        -- Datos adicionales para contexto
        COALESCE(SUM(c.precio_servicio), 0) as gasto_total,
        COALESCE(AVG(c.precio_servicio), 0) as ticket_promedio,
        MAX(c.fecha_consulta) as ultima_cita
        
      FROM pacientes p
      LEFT JOIN citas c ON p.id = c.paciente_id AND c.archivado = 0
      WHERE p.estado != 'Eliminado'
      ${edad_min > 0 || edad_max < 100 ? 
        'AND TIMESTAMPDIFF(YEAR, p.fechaNacimiento, CURDATE()) BETWEEN ? AND ?' : ''}
      ${ubicaciones.length > 0 ? 
        'AND p.lugar IN (' + ubicaciones.map(() => '?').join(',') + ')' : ''}
      ${search.trim() ? 
        'AND (CONCAT(p.nombre, " ", p.aPaterno, " ", COALESCE(p.aMaterno, "")) LIKE ? OR p.email LIKE ?)' : ''}
      GROUP BY p.id, p.nombre, p.aPaterno, p.aMaterno, p.fechaNacimiento, 
               p.genero, p.lugar, p.telefono, p.email, p.estado
      HAVING total_citas >= ?
      ORDER BY total_citas DESC, gasto_total DESC
      LIMIT ?
    `;

    // Construir parámetros dinámicamente
    let queryParams = [];
    if (edad_min > 0 || edad_max < 100) {
      queryParams.push(edad_min, edad_max);
    }
    if (ubicaciones.length > 0) {
      queryParams.push(...ubicaciones);
    }
    if (search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      queryParams.push(searchTerm, searchTerm);
    }
    queryParams.push(total_citas_min, limit);

    console.log("Query segmentación:", query);
    console.log("Parámetros:", queryParams);

    db.query(query, queryParams, async (err, results) => {
      if (err) {
        console.error("Error en query segmentación:", err);
        return res.status(500).json({
          success: false,
          error: "Error obteniendo pacientes",
          details: err.message,
        });
      }

      console.log(`Pacientes obtenidos: ${results.length}`);

      // Aplicar clustering con métricas correctas
      const patientsWithSegments = [];
      let segmentStats = { Cumplido: 0, Problemático: 0, Irregular: 0, ERRORES: 0 };

      for (const patient of results) {
        try {
          // Preparar datos correctos para clustering
          const clusteringData = {
            paciente_id: patient.paciente_id,
            tasa_noshow: parseFloat(patient.tasa_noshow) || 0.0,
            tasa_completion: parseFloat(patient.tasa_completion) || 0.0,
            citas_canceladas: parseInt(patient.citas_canceladas) || 0,
            tasa_pago_exitoso: parseFloat(patient.tasa_pago_exitoso) || 0.0
          };

          // Llamar al script de clustering
          const classificationResult = await executePatientClassification(clusteringData);

          if (classificationResult.success) {
            patientsWithSegments.push({
              ...patient,
              cluster: classificationResult.cluster,
              segmento: classificationResult.segmento,
              confidence: classificationResult.confidence,
              clasificacion_exitosa: true,
            });
            segmentStats[classificationResult.segmento]++;
          } else {
            patientsWithSegments.push({
              ...patient,
              cluster: null,
              segmento: "NO_CLASIFICADO",
              confidence: 0,
              clasificacion_exitosa: false,
              error_clasificacion: classificationResult.error,
            });
            segmentStats.ERRORES++;
          }
        } catch (clusterError) {
          console.error(`Error clasificando paciente ${patient.paciente_id}:`, clusterError);
          patientsWithSegments.push({
            ...patient,
            cluster: null,
            segmento: "ERROR",
            confidence: 0,
            clasificacion_exitosa: false,
            error_clasificacion: clusterError.message,
          });
          segmentStats.ERRORES++;
        }
      }

      console.log("=== SEGMENTACIÓN COMPLETADA ===");
      console.log("Estadísticas por segmento:", segmentStats);

      res.json({
        success: true,
        data: {
          pacientes: patientsWithSegments,
          estadisticas: {
            total_pacientes: patientsWithSegments.length,
            segmentos: segmentStats,
            filtros_aplicados: {
              edad_min,
              edad_max,
              ubicaciones,
              servicios,
              total_citas_min,
              search,
            },
          },
        },
      });
    });
  } catch (error) {
    console.error("Error en patients-segmentation:", error);
    res.status(500).json({
      success: false,
      error: `Error interno del servidor: ${error.message}`,
    });
  }
});
/**
 * ENDPOINT CORREGIDO: Obtener opciones para filtros dinámicos
 */
router.get("/filter-options", async (req, res) => {
  try {
    console.log("=== OBTENIENDO OPCIONES DE FILTROS ===");

    // Query para obtener ubicaciones únicas
    const ubicacionesQuery = `
      SELECT DISTINCT lugar as ubicacion, COUNT(*) as count
      FROM pacientes 
      WHERE estado != 'Eliminado' AND lugar IS NOT NULL AND lugar != ''
      GROUP BY lugar
      ORDER BY count DESC, lugar ASC
    `;

    // Query para obtener servicios únicos (usando campos correctos)
    const serviciosQuery = `
      SELECT DISTINCT s.id, s.title, s.category, COUNT(c.id) as uso_count
      FROM servicios s
      LEFT JOIN citas c ON s.id = c.servicio_id AND c.archivado = 0
      WHERE s.title IS NOT NULL
      GROUP BY s.id, s.title, s.category
      ORDER BY uso_count DESC, s.title ASC
      LIMIT 50
    `;

    // Query para obtener rangos de datos
    const rangosQuery = `
      SELECT 
        MIN(TIMESTAMPDIFF(YEAR, fechaNacimiento, CURDATE())) as edad_min,
        MAX(TIMESTAMPDIFF(YEAR, fechaNacimiento, CURDATE())) as edad_max,
        COUNT(*) as total_pacientes
      FROM pacientes 
      WHERE estado != 'Eliminado' AND fechaNacimiento IS NOT NULL
    `;

    // Query para rangos de gastos (corregida)
    const gastosQuery = `
      SELECT 
        MIN(gasto_total) as gasto_min,
        MAX(gasto_total) as gasto_max,
        AVG(gasto_total) as gasto_promedio
      FROM (
        SELECT p.id, COALESCE(SUM(c.precio_servicio), 0) as gasto_total
        FROM pacientes p
        LEFT JOIN citas c ON p.id = c.paciente_id AND c.archivado = 0
        WHERE p.estado != 'Eliminado'
        GROUP BY p.id
      ) as gastos_pacientes
      WHERE gasto_total > 0
    `;

    // Ejecutar queries en paralelo
    const [ubicaciones, servicios, rangos, gastos] = await Promise.all([
      new Promise((resolve, reject) => {
        db.query(ubicacionesQuery, (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        });
      }),
      new Promise((resolve, reject) => {
        db.query(serviciosQuery, (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        });
      }),
      new Promise((resolve, reject) => {
        db.query(rangosQuery, (err, results) => {
          if (err) reject(err);
          else
            resolve(
              results[0] || { edad_min: 18, edad_max: 80, total_pacientes: 0 }
            );
        });
      }),
      new Promise((resolve, reject) => {
        db.query(gastosQuery, (err, results) => {
          if (err) reject(err);
          else
            resolve(
              results[0] || {
                gasto_min: 0,
                gasto_max: 10000,
                gasto_promedio: 0,
              }
            );
        });
      }),
    ]);

    res.json({
      success: true,
      options: {
        ubicaciones: ubicaciones.map((u) => ({
          value: u.ubicacion,
          label: `${u.ubicacion} (${u.count})`,
          count: u.count,
        })),
        servicios: servicios.map((s) => ({
          value: s.id,
          label: s.title,
          category: s.category,
          uso_count: s.uso_count,
        })),
        rangos: {
          edad: {
            min: rangos.edad_min || 18,
            max: rangos.edad_max || 80,
          },
          gastos: {
            min: 0,
            max: Math.ceil((gastos.gasto_max || 10000) * 1.1), // 10% extra para el slider
            promedio: gastos.gasto_promedio || 0,
          },
        },
        total_pacientes: rangos.total_pacientes || 0,
      },
    });
  } catch (error) {
    console.error("Error obteniendo opciones de filtros:", error);
    res.status(500).json({
      success: false,
      error: `Error obteniendo opciones: ${error.message}`,
    });
  }
});
module.exports = router;
