// Archivo: routes/admin/predictions.js

const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');
const db = require('../../db');

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
        console.error('Error en query historial:', err);
        reject(err);
      } else {
        const historial = results[0] || {
          total_citas: 1,
          total_no_shows: 0,
          pct_no_show_historico: 0.0,
          dias_desde_ultima_cita: 0
        };
        
        // Asegurar que no haya valores null
        historial.total_citas = historial.total_citas || 1;
        historial.total_no_shows = historial.total_no_shows || 0;
        historial.pct_no_show_historico = historial.pct_no_show_historico || 0.0;
        historial.dias_desde_ultima_cita = historial.dias_desde_ultima_cita || 0;
        
        console.log('Historial obtenido para paciente:', pacienteId, historial);
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
    const pythonScript = path.join(__dirname, '../../models/ml_predictions.py');
    
    console.log('Ejecutando script Python:', pythonScript);
    console.log('Datos enviados al modelo:', JSON.stringify(citaData, null, 2));
    
    // Usar python3 o python según tu sistema
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    const pythonProcess = spawn(pythonCommand, [pythonScript]);
    
    let result = '';
    let error = '';
    
    // Enviar datos JSON al script Python
    pythonProcess.stdin.write(JSON.stringify(citaData));
    pythonProcess.stdin.end();
    
    // Recoger resultado del stdout
    pythonProcess.stdout.on('data', (data) => {
      result += data.toString();
    });
    
    // Recoger errores del stderr
    pythonProcess.stderr.on('data', (data) => {
      error += data.toString();
      console.error('Error Python stderr:', data.toString());
    });
    
    // Cuando termina el proceso
    pythonProcess.on('close', (code) => {
      console.log(`Proceso Python terminó con código: ${code}`);
      console.log('Resultado Python:', result);
      
      if (code !== 0) {
        console.error('Error Python:', error);
        reject(new Error(`Script Python falló (código ${code}): ${error}`));
      } else {
        try {
          const parsedResult = JSON.parse(result.trim());
          resolve(parsedResult);
        } catch (parseError) {
          console.error('Error parseando resultado Python:', parseError);
          reject(new Error(`Error parseando resultado: ${parseError.message}`));
        }
      }
    });
    
    // Manejar timeout (30 segundos)
    const timeout = setTimeout(() => {
      console.log('Timeout en predicción ML');
      pythonProcess.kill();
      reject(new Error('Timeout en predicción ML (30s)'));
    }, 30000);
    
    pythonProcess.on('close', () => {
      clearTimeout(timeout);
    });
  });
};

/**
 * Endpoint principal para predicción de no-show
 * POST /api/ml/predict-no-show
 */
router.post('/predict-no-show', async (req, res) => {
  try {
    const citaData = req.body;
    
    console.log('=== PREDICCIÓN ML SOLICITADA ===');
    console.log('Datos recibidos:', JSON.stringify(citaData, null, 2));
    
    if (!citaData || !citaData.paciente_id) {
      return res.status(400).json({
        success: false,
        error: 'Datos de cita incompletos. Se requiere paciente_id.'
      });
    }
    
    // Obtener historial del paciente desde la BD
    try {
      const historial = await getPacienteHistorial(citaData.paciente_id);
      
      // Combinar datos de la cita con historial del paciente
      const citaCompleta = {
        ...citaData,
        total_citas_historicas: historial.total_citas,
        total_no_shows_historicas: historial.total_no_shows,
        pct_no_show_historico: historial.pct_no_show_historico,
        dias_desde_ultima_cita: historial.dias_desde_ultima_cita
      };
      
      console.log('Cita con historial:', JSON.stringify(citaCompleta, null, 2));
      
      // Llamar al modelo Python
      const prediccion = await callPythonPredictor(citaCompleta);
      
      if (prediccion.error) {
        console.error('Error en modelo ML:', prediccion.error);
        return res.status(500).json({
          success: false,
          error: `Error en modelo: ${prediccion.error}`
        });
      }
      
      console.log('=== PREDICCIÓN EXITOSA ===');
      console.log('Probabilidad:', prediccion.prediction.probability);
      console.log('Nivel de riesgo:', prediccion.prediction.risk_level);
      
      res.json(prediccion);
      
    } catch (historialError) {
      console.error('Error obteniendo historial del paciente:', historialError);
      return res.status(500).json({
        success: false,
        error: 'Error obteniendo historial del paciente'
      });
    }
    
  } catch (error) {
    console.error('Error general en predicción:', error);
    res.status(500).json({
      success: false,
      error: `Error interno del servidor: ${error.message}`
    });
  }
});

/**
 * Endpoint para predicciones en lote (múltiples citas)
 * POST /api/ml/predict-batch
 */
router.post('/predict-batch', async (req, res) => {
  try {
    const { citas } = req.body;
    
    if (!Array.isArray(citas) || citas.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere un array de citas no vacío'
      });
    }
    
    console.log(`=== PREDICCIÓN BATCH: ${citas.length} citas ===`);
    
    const predicciones = [];
    
    // Procesar cada cita
    for (let i = 0; i < citas.length; i++) {
      const cita = citas[i];
      console.log(`Procesando cita ${i + 1}/${citas.length}`);
      
      try {
        if (!cita.paciente_id) {
          predicciones.push({
            cita_id: cita.cita_id || cita.id,
            success: false,
            prediction: null,
            error: 'paciente_id requerido'
          });
          continue;
        }
        
        const historial = await getPacienteHistorial(cita.paciente_id);
        const citaCompleta = {
          ...cita,
          total_citas_historicas: historial.total_citas,
          total_no_shows_historicas: historial.total_no_shows,
          pct_no_show_historico: historial.pct_no_show_historico,
          dias_desde_ultima_cita: historial.dias_desde_ultima_cita
        };
        
        const prediccion = await callPythonPredictor(citaCompleta);
        
        predicciones.push({
          cita_id: cita.cita_id || cita.id,
          success: !prediccion.error,
          prediction: prediccion.prediction || null,
          error: prediccion.error || null
        });
        
      } catch (error) {
        console.error(`Error procesando cita ${i + 1}:`, error);
        predicciones.push({
          cita_id: cita.cita_id || cita.id,
          success: false,
          prediction: null,
          error: error.message
        });
      }
    }
    
    console.log(`=== BATCH COMPLETADO: ${predicciones.length} predicciones ===`);
    
    res.json({
      success: true,
      predictions: predicciones,
      summary: {
        total: predicciones.length,
        successful: predicciones.filter(p => p.success).length,
        failed: predicciones.filter(p => !p.success).length
      }
    });
    
  } catch (error) {
    console.error('Error en predicción batch:', error);
    res.status(500).json({
      success: false,
      error: `Error interno del servidor: ${error.message}`
    });
  }
});

/**
 * Información del modelo y status
 * GET /api/ml/model-info
 */
router.get('/model-info', (req, res) => {
  res.json({
    success: true,
    model_info: {
      name: 'No-Show Predictor',
      type: 'RandomForestClassifier',
      version: '1.0.0',
      features: [
        'edad', 'genero', 'alergias_flag', 'registro_completo', 'verificado',
        'lead_time_days', 'dow', 'hour', 'is_weekend', 'categoria_servicio',
        'precio_servicio', 'duration_min', 'paid_flag', 'tratamiento_pendiente',
        'total_citas', 'total_no_shows', 'pct_no_show_historico', 'dias_desde_ultima_cita'
      ],
      available: true,
      description: 'Modelo para predecir la probabilidad de que un paciente no asista a su cita'
    },
    endpoints: {
      predict_single: 'POST /api/ml/predict-no-show',
      predict_batch: 'POST /api/ml/predict-batch',
      model_info: 'GET /api/ml/model-info'
    }
  });
});

/**
 * Endpoint de prueba/salud
 * GET /api/ml/health
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    message: 'ML Predictions service is running'
  });
});

module.exports = router;