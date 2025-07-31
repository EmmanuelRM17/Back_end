// Archivo: routes/admin/predictions.js

const express = require("express");
const router = express.Router();
const { spawn } = require("child_process");
const nodemailer = require("nodemailer");
const path = require("path");
const db = require("../../db");

// Configuración de nodemailer
const transporter = nodemailer.createTransporter({
  host: "smtp.hostinger.com",
  port: 465,
  secure: true,
  auth: {
    user: "sistema@odontologiacarol.com",
    pass: "sP8+?;Vs:",
  },
});

/**
 * Obtener historial de no-shows del paciente desde la BD
 */
const getPacienteHistorial = (pacienteId) => {
  return new Promise((resolve, reject) => {
    const query = `
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
    `;

    db.query(query, [pacienteId], (err, results) => {
      if (err) {
        console.error("Error en query historial:", err);
        reject(err);
      } else {
        const historial = results[0] || {
          total_citas: 1,
          total_no_shows: 0,
          pct_no_show_historico: 0.0,
          dias_desde_ultima_cita: 0,
        };

        // Asegurar que no haya valores null
        historial.total_citas = historial.total_citas || 1;
        historial.total_no_shows = historial.total_no_shows || 0;
        historial.pct_no_show_historico = historial.pct_no_show_historico || 0.0;
        historial.dias_desde_ultima_cita = historial.dias_desde_ultima_cita || 0;

        console.log("Historial obtenido para paciente:", pacienteId, historial);
        resolve(historial);
      }
    });
  });
};

/**
 * Llamar al script Python para hacer predicción ML
 */
const callPythonPredictor = (citaData) => {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, "../../models/ml_predictions.py");

    console.log("Ejecutando script Python:", pythonScript);
    console.log("Datos enviados al modelo:", JSON.stringify(citaData, null, 2));

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
      console.error("Error Python stderr:", data.toString());
    });

    pythonProcess.on("close", (code) => {
      console.log(`Proceso Python terminó con código: ${code}`);
      console.log("Resultado Python:", result);

      if (code !== 0) {
        console.error("Error Python:", error);
        reject(new Error(`Script Python falló (código ${code}): ${error}`));
      } else {
        try {
          const parsedResult = JSON.parse(result.trim());
          resolve(parsedResult);
        } catch (parseError) {
          console.error("Error parseando resultado Python:", parseError);
          reject(new Error(`Error parseando resultado: ${parseError.message}`));
        }
      }
    });

    const timeout = setTimeout(() => {
      console.log("Timeout en predicción ML");
      pythonProcess.kill();
      reject(new Error("Timeout en predicción ML (30s)"));
    }, 30000);

    pythonProcess.on("close", () => {
      clearTimeout(timeout);
    });
  });
};

/**
 * Endpoint principal para predicción de no-show
 * POST /api/ml/predict-no-show
 */
router.post("/predict-no-show", async (req, res) => {
  try {
    const citaData = req.body;

    console.log("=== PREDICCIÓN ML SOLICITADA ===");
    console.log("Datos recibidos:", JSON.stringify(citaData, null, 2));

    if (!citaData || !citaData.paciente_id) {
      return res.status(400).json({
        success: false,
        error: "Datos de cita incompletos. Se requiere paciente_id.",
      });
    }

    try {
      const historial = await getPacienteHistorial(citaData.paciente_id);

      const citaCompleta = {
        ...citaData,
        total_citas_historicas: historial.total_citas,
        total_no_shows_historicas: historial.total_no_shows,
        pct_no_show_historico: historial.pct_no_show_historico,
        dias_desde_ultima_cita: historial.dias_desde_ultima_cita,
      };

      console.log("Cita con historial:", JSON.stringify(citaCompleta, null, 2));

      const prediccion = await callPythonPredictor(citaCompleta);

      if (prediccion.error) {
        console.error("Error en modelo ML:", prediccion.error);
        return res.status(500).json({
          success: false,
          error: `Error en modelo: ${prediccion.error}`,
        });
      }

      // Interpretar resultado binario (1 = No Show, 0 = Asistirá)
      const willNoShow = prediccion.prediction.will_no_show === 1;
      
      console.log("=== PREDICCIÓN EXITOSA ===");
      console.log("Predicción binaria:", prediccion.prediction.will_no_show);
      console.log("Interpretación:", willNoShow ? "NO ASISTIRÁ" : "ASISTIRÁ");

      res.json({
        success: true,
        prediction: {
          will_no_show: willNoShow,
          prediction_binary: prediccion.prediction.will_no_show,
          risk_level: willNoShow ? "ALTO" : "BAJO",
          mensaje: willNoShow 
            ? "El modelo predice que este paciente probablemente NO asistirá a su cita"
            : "El modelo predice que este paciente probablemente SÍ asistirá a su cita"
        }
      });

    } catch (historialError) {
      console.error("Error obteniendo historial del paciente:", historialError);
      return res.status(500).json({
        success: false,
        error: "Error obteniendo historial del paciente",
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
 * Endpoint para predicciones en lote (múltiples citas)
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
      console.log(`Procesando cita ${i + 1}/${citas.length}`);

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

        const historial = await getPacienteHistorial(cita.paciente_id);
        const citaCompleta = {
          ...cita,
          total_citas_historicas: historial.total_citas,
          total_no_shows_historicas: historial.total_no_shows,
          pct_no_show_historico: historial.pct_no_show_historico,
          dias_desde_ultima_cita: historial.dias_desde_ultima_cita,
        };

        const prediccion = await callPythonPredictor(citaCompleta);

        if (prediccion.error) {
          predicciones.push({
            cita_id: cita.cita_id || cita.id,
            success: false,
            prediction: null,
            error: prediccion.error,
          });
        } else {
          const willNoShow = prediccion.prediction.will_no_show === 1;
          predicciones.push({
            cita_id: cita.cita_id || cita.id,
            success: true,
            prediction: {
              will_no_show: willNoShow,
              prediction_binary: prediccion.prediction.will_no_show,
              risk_level: willNoShow ? "ALTO" : "BAJO"
            },
            error: null,
          });
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

    const successful = predicciones.filter(p => p.success);
    const altoRiesgo = successful.filter(p => p.prediction.will_no_show).length;

    console.log(`=== BATCH COMPLETADO ===`);
    console.log(`Total: ${predicciones.length}, Exitosas: ${successful.length}, Alto riesgo: ${altoRiesgo}`);

    res.json({
      success: true,
      predictions: predicciones,
      summary: {
        total: predicciones.length,
        successful: successful.length,
        failed: predicciones.filter(p => !p.success).length,
        alto_riesgo: altoRiesgo,
        bajo_riesgo: successful.length - altoRiesgo
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
 * Información del modelo y status - CORREGIDO
 */
router.get("/model-info", (req, res) => {
  res.json({
    success: true,
    model_info: {
      name: "No-Show Predictor",
      type: "RandomForestClassifier",
      version: "1.0.0",
      output_type: "binary_classification",
      classes: [0, 1], // 0 = Asistirá, 1 = No Show
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
        "dias_desde_ultima_cita"
      ],
      available: true,
      description: "Modelo de clasificación binaria para predecir si un paciente asistirá (0) o no asistirá (1) a su cita",
    },
    endpoints: {
      predict_single: "POST /api/ml/predict-no-show",
      predict_batch: "POST /api/ml/predict-batch", 
      model_info: "GET /api/ml/model-info",
    },
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
                (Date.now() - new Date(citaDetalles.fecha_nacimiento).getTime()) /
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
          total_no_shows_historicas: citaDetalles.total_no_shows_historicas || 0,
          pct_no_show_historico: parseFloat(citaDetalles.pct_no_show_historico) || 0.0,
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
            ? new Date(citaDetalles.fecha_consulta).toLocaleDateString("es-ES", {
                weekday: "long",
              })
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
          descripcion: "Los pacientes no registrados tienen mayor riesgo de inasistencia",
        });
      } else if (response.detalles.pct_no_show_historico > 0.2) {
        factores.push({
          factor: "Historial de inasistencias",
          valor: `${(response.detalles.pct_no_show_historico * 100).toFixed(1)}%`,
          impacto: response.detalles.pct_no_show_historico > 0.4 ? "Alto" : "Medio",
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
 * Endpoint de prueba/salud
 */
router.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    message: "ML Predictions service is running",
    model_type: "binary_classification"
  });
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
        fechaInicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
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
            stats.total_citas > 0 ? ((stats.citas_completadas / stats.total_citas) * 100).toFixed(1) : 0,
          tasa_cancelacion:
            stats.total_citas > 0 ? ((stats.citas_canceladas / stats.total_citas) * 100).toFixed(1) : 0,
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
      const nombreCompleto = `${citaInfo.nombre} ${citaInfo.apellido_paterno || ""} ${citaInfo.apellido_materno || ""}`.trim();
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
                              <td style="padding: 8px 0; color: #333;">${citaInfo.servicio_nombre || "Consulta General"}</td>
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

module.exports = router;