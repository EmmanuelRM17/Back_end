const express = require("express");
const db = require("../../../db");
const router = express.Router();

// Función para obtener filtros de fecha
const getFiltrosFecha = (req) => {
  const { fechaInicio, fechaFin, periodo } = req.query;
  
  let whereClause = "";
  let params = [];
  
  if (periodo) {
    switch (periodo) {
      case 'hoy':
        whereClause = "DATE(fecha_consulta) = CURRENT_DATE()";
        break;
      case 'semana':
        whereClause = `fecha_consulta BETWEEN 
          DATE_SUB(CURRENT_DATE(), INTERVAL WEEKDAY(CURRENT_DATE()) DAY) 
          AND DATE_ADD(DATE_SUB(CURRENT_DATE(), INTERVAL WEEKDAY(CURRENT_DATE()) DAY), INTERVAL 6 DAY)`;
        break;
      case 'mes':
        whereClause = `MONTH(fecha_consulta) = MONTH(CURRENT_DATE()) 
          AND YEAR(fecha_consulta) = YEAR(CURRENT_DATE())`;
        break;
      case 'trimestre':
        whereClause = `QUARTER(fecha_consulta) = QUARTER(CURRENT_DATE()) 
          AND YEAR(fecha_consulta) = YEAR(CURRENT_DATE())`;
        break;
      case 'ano':
        whereClause = "YEAR(fecha_consulta) = YEAR(CURRENT_DATE())";
        break;
    }
  } else if (fechaInicio && fechaFin) {
    whereClause = "DATE(fecha_consulta) BETWEEN ? AND ?";
    params = [fechaInicio, fechaFin];
  } else {
    // Por defecto últimos 30 días
    whereClause = "fecha_consulta >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)";
  }
  
  return { whereClause, params };
};

// Endpoint mejorado para obtener servicios más realizados con filtros
router.get("/topservicios", async (req, res) => {
  try {
    const { servicio, limite = 10 } = req.query;
    const { whereClause, params } = getFiltrosFecha(req);
    
    let query = `
      SELECT 
        servicio_nombre, 
        COUNT(*) AS total_realizados,
        AVG(CASE WHEN p.monto IS NOT NULL THEN p.monto ELSE 0 END) AS promedio_ingresos
      FROM citas c
      LEFT JOIN pagos p ON c.id = p.cita_id AND p.estado = 'Pagado'
      WHERE ${whereClause}
    `;
    
    // Filtro por servicio específico
    if (servicio && servicio !== 'todos') {
      query += ` AND servicio_nombre LIKE ?`;
      params.push(`%${servicio}%`);
    }
    
    query += `
      GROUP BY servicio_nombre
      ORDER BY total_realizados DESC
      LIMIT ?
    `;
    params.push(parseInt(limite));

    db.query(query, params, (err, results) => {
      if (err) {
        console.error("Error al obtener tratamientos:", err);
        return res.status(500).json({ error: "Error interno del servidor" });
      }
      
      // Si no hay resultados, devolver array vacío en lugar de error
      res.json(results.length > 0 ? results : []);
    });
  } catch (error) {
    console.error("Error en la consulta:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// Endpoint mejorado para ingresos mensuales con filtros
router.get("/ingresos-mensuales", async (req, res) => {
  try {
    const { ano = new Date().getFullYear(), servicio } = req.query;
    
    let query = `
      SELECT 
        MONTH(p.fecha_pago) AS mes,
        MONTHNAME(p.fecha_pago) AS nombre_mes,
        CAST(SUM(p.monto) AS DECIMAL(10,2)) AS total_ingresos,
        COUNT(p.id) AS total_transacciones,
        AVG(p.monto) AS promedio_transaccion
      FROM pagos p
      JOIN citas c ON p.cita_id = c.id
      WHERE p.estado = 'Pagado' 
        AND YEAR(p.fecha_pago) = ?
    `;
    
    let params = [ano];
    
    // Filtro por servicio
    if (servicio && servicio !== 'todos') {
      query += ` AND c.servicio_nombre LIKE ?`;
      params.push(`%${servicio}%`);
    }
    
    query += `
      GROUP BY MONTH(p.fecha_pago), MONTHNAME(p.fecha_pago)
      ORDER BY mes ASC
    `;

    db.query(query, params, (err, results) => {
      if (err) {
        console.error("Error al obtener ingresos:", err);
        return res.status(500).json({ error: "Error interno del servidor" });
      }
      
      // Si no hay datos, crear estructura vacía para evitar errores en frontend
      if (results.length === 0) {
        return res.json([]);
      }
      
      res.json(results);
    });
  } catch (error) {
    console.error("Error en la consulta:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// Endpoint mejorado para citas por día con filtros
router.get("/citas-por-dia", async (req, res) => {
  try {
    const { estado, doctor_id } = req.query;
    const { whereClause, params } = getFiltrosFecha(req);
    
    let query = `
      SELECT 
        WEEKDAY(fecha_consulta) AS dia_semana,
        DAYNAME(fecha_consulta) AS nombre_dia,
        COUNT(*) AS total_citas,
        COUNT(CASE WHEN estado = 'Completada' THEN 1 END) AS citas_completadas,
        COUNT(CASE WHEN estado = 'Cancelada' THEN 1 END) AS citas_canceladas
      FROM citas
      WHERE ${whereClause}
    `;
    
    // Filtro por estado
    if (estado && estado !== 'todos') {
      query += ` AND estado = ?`;
      params.push(estado);
    }
    
    // Filtro por doctor (si tienes esa relación)
    if (doctor_id && doctor_id !== 'todos') {
      query += ` AND empleado_id = ?`;
      params.push(doctor_id);
    }
    
    query += `
      GROUP BY WEEKDAY(fecha_consulta), DAYNAME(fecha_consulta)
      ORDER BY dia_semana ASC
    `;

    db.query(query, params, (err, results) => {
      if (err) {
        console.error("Error al obtener citas por día:", err);
        return res.status(500).json({ error: "Error interno del servidor" });
      }
      res.json(results);
    });
  } catch (error) {
    console.error("Error en la consulta:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// Endpoint mejorado para próximas citas con filtros
router.get("/proximas-citas", async (req, res) => {
  try {
    const { limite = 6, estado, servicio } = req.query;
    
    let query = `
      SELECT 
        c.id,
        p.nombre,
        p.aPaterno,
        p.aMaterno,
        c.servicio_nombre,
        c.fecha_consulta,
        c.estado,
        c.precio_servicio,
        pg.estado AS estado_pago
      FROM citas c
      JOIN pacientes p ON c.paciente_id = p.id
      LEFT JOIN pagos pg ON c.id = pg.cita_id
      WHERE c.fecha_consulta >= CURRENT_DATE()
    `;
    
    let params = [];
    
    // Filtro por estado
    if (estado && estado !== 'todos') {
      query += ` AND c.estado = ?`;
      params.push(estado);
    } else {
      query += ` AND (c.estado = 'Pendiente' OR c.estado = 'Confirmada')`;
    }
    
    // Filtro por servicio
    if (servicio && servicio !== 'todos') {
      query += ` AND c.servicio_nombre LIKE ?`;
      params.push(`%${servicio}%`);
    }
    
    query += `
      ORDER BY c.fecha_consulta ASC
      LIMIT ?
    `;
    params.push(parseInt(limite));

    db.query(query, params, (err, results) => {
      if (err) {
        console.error("Error al obtener próximas citas:", err);
        return res.status(500).json({ error: "Error interno del servidor" });
      }
      res.json(results);
    });
  } catch (error) {
    console.error("Error en la consulta:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// Endpoint mejorado para métricas con filtros
router.get("/metricas-resumen", async (req, res) => {
  try {
    const { periodo = 'actual' } = req.query;
    
    // Obtener métricas actuales
    const queryCitasHoy = `
      SELECT COUNT(*) AS total
      FROM citas
      WHERE DATE(fecha_consulta) = CURRENT_DATE()
      AND (estado = 'Pendiente' OR estado = 'Confirmada')
    `;
    
    const queryCitasSemana = `
      SELECT COUNT(*) AS total
      FROM citas
      WHERE fecha_consulta BETWEEN 
        DATE_SUB(CURRENT_DATE(), INTERVAL WEEKDAY(CURRENT_DATE()) DAY) 
        AND DATE_ADD(DATE_SUB(CURRENT_DATE(), INTERVAL WEEKDAY(CURRENT_DATE()) DAY), INTERVAL 6 DAY)
      AND (estado = 'Pendiente' OR estado = 'Confirmada')
    `;
    
    const queryNuevosPacientes = `
      SELECT COUNT(*) AS total
      FROM pacientes
      WHERE MONTH(fecha_creacion) = MONTH(CURRENT_DATE())
      AND YEAR(fecha_creacion) = YEAR(CURRENT_DATE())
    `;
    
    const queryIngresosSemana = `
      SELECT COALESCE(SUM(monto), 0) AS total
      FROM pagos
      WHERE fecha_pago BETWEEN 
        DATE_SUB(CURRENT_DATE(), INTERVAL WEEKDAY(CURRENT_DATE()) DAY) 
        AND DATE_ADD(DATE_SUB(CURRENT_DATE(), INTERVAL WEEKDAY(CURRENT_DATE()) DAY), INTERVAL 6 DAY)
      AND estado = 'Pagado'
    `;
    
    const queryIngresosMes = `
      SELECT COALESCE(SUM(monto), 0) AS total
      FROM pagos
      WHERE MONTH(fecha_pago) = MONTH(CURRENT_DATE())
      AND YEAR(fecha_pago) = YEAR(CURRENT_DATE())
      AND estado = 'Pagado'
    `;
    
    const queryTasaOcupacion = `
      SELECT
        ROUND(
          (COUNT(CASE WHEN estado != 'Cancelada' THEN 1 END) / 
          GREATEST(COUNT(*), 1)) * 100, 1
        ) AS tasa
      FROM citas
      WHERE fecha_consulta BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND CURRENT_DATE()
    `;

    // Ejecutar todas las consultas en paralelo usando promesas
    const executeQuery = (query) => {
      return new Promise((resolve, reject) => {
        db.query(query, (err, results) => {
          if (err) {
            reject(err);
          } else {
            resolve(results[0]);
          }
        });
      });
    };

    try {
      const [
        citasHoy,
        citasSemana, 
        nuevosPacientes,
        ingresosSemana,
        ingresosMes,
        tasaOcupacion
      ] = await Promise.all([
        executeQuery(queryCitasHoy),
        executeQuery(queryCitasSemana),
        executeQuery(queryNuevosPacientes),
        executeQuery(queryIngresosSemana),
        executeQuery(queryIngresosMes),
        executeQuery(queryTasaOcupacion)
      ]);

      res.json({
        citas_hoy: citasHoy.total || 0,
        citas_semana: citasSemana.total || 0,
        nuevos_pacientes: nuevosPacientes.total || 0,
        ingresos_semana: parseFloat(ingresosSemana.total) || 0,
        ingresos_mes: parseFloat(ingresosMes.total) || 0,
        tasa_ocupacion: parseFloat(tasaOcupacion.tasa) || 0,
        fecha_actualizacion: new Date().toISOString()
      });
    } catch (err) {
      console.error("Error en consultas paralelas:", err);
      res.status(500).json({ error: "Error al obtener métricas" });
    }
  } catch (error) {
    console.error("Error en la consulta:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// Nuevo endpoint para obtener opciones de filtros
router.get("/filtros-opciones", async (req, res) => {
  try {
    // Obtener servicios únicos
    const queryServicios = `
      SELECT DISTINCT servicio_nombre
      FROM citas
      WHERE servicio_nombre IS NOT NULL
      ORDER BY servicio_nombre ASC
    `;
    
    // Obtener estados de citas
    const queryEstados = `
      SELECT DISTINCT estado
      FROM citas
      WHERE estado IS NOT NULL
      ORDER BY estado ASC
    `;
    
    // Obtener años disponibles
    const queryAnos = `
      SELECT DISTINCT YEAR(fecha_consulta) AS ano
      FROM citas
      ORDER BY ano DESC
    `;

    db.query(queryServicios, (err, servicios) => {
      if (err) {
        console.error("Error al obtener servicios:", err);
        return res.status(500).json({ error: "Error interno del servidor" });
      }
      
      db.query(queryEstados, (err, estados) => {
        if (err) {
          console.error("Error al obtener estados:", err);
          return res.status(500).json({ error: "Error interno del servidor" });
        }
        
        db.query(queryAnos, (err, anos) => {
          if (err) {
            console.error("Error al obtener años:", err);
            return res.status(500).json({ error: "Error interno del servidor" });
          }
          
          res.json({
            servicios: servicios.map(s => s.servicio_nombre),
            estados: estados.map(e => e.estado),
            anos: anos.map(a => a.ano)
          });
        });
      });
    });
  } catch (error) {
    console.error("Error en la consulta:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

module.exports = router;