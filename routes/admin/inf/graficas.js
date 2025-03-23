const express = require("express");
const db = require("../../../db"); // Ruta correcta a tu conexión de base de datos
const router = express.Router();

// Endpoint para obtener los tratamientos más realizados
router.get("/topservicios", async (req, res) => {
  try {
    const query = `
      SELECT servicio_nombre, COUNT(*) AS total_realizados
      FROM citas
      GROUP BY servicio_nombre
      ORDER BY total_realizados DESC;
    `;

    db.query(query, (err, results) => {
      if (err) {
        console.error("Error al obtener tratamientos:", err);
        return res.status(500).json({ error: "Error interno del servidor" });
      }
      res.json(results);
    });
  } catch (error) {
    console.error("Error en la consulta:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// Endpoint para obtener los ingresos mensuales
router.get("/ingresos-mensuales", async (req, res) => {
  try {
    const query = `
      SELECT 
        MONTH(p.fecha_pago) AS mes,
        CAST(SUM(p.monto) AS DECIMAL(10,2)) AS total_ingresos
      FROM 
        pagos p
      WHERE 
        p.estado = 'Pagado' AND
        YEAR(p.fecha_pago) = YEAR(CURRENT_DATE())
      GROUP BY 
        MONTH(p.fecha_pago)
      ORDER BY 
        mes ASC;
    `;

    db.query(query, (err, results) => {
      if (err) {
        console.error("Error al obtener ingresos:", err);
        return res.status(500).json({ error: "Error interno del servidor" });
      }
      res.json(results);
    });
  } catch (error) {
    console.error("Error en la consulta:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// Endpoint para obtener las citas por día de la semana
router.get("/citas-por-dia", async (req, res) => {
  try {
    const query = `
      SELECT 
        WEEKDAY(fecha_consulta) AS dia_semana,
        COUNT(*) AS total_citas
      FROM 
        citas
      WHERE 
        fecha_consulta >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
      GROUP BY 
        WEEKDAY(fecha_consulta)
      ORDER BY 
        dia_semana ASC;
    `;

    db.query(query, (err, results) => {
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

// Endpoint para obtener las próximas citas
router.get("/proximas-citas", async (req, res) => {
  try {
    const query = `
      SELECT 
        c.id,
        p.nombre,
        p.aPaterno,
        c.servicio_nombre,
        c.fecha_consulta,
        c.estado
      FROM 
        citas c
        JOIN pacientes p ON c.paciente_id = p.id
      WHERE 
        c.fecha_consulta >= CURRENT_DATE()
        AND (c.estado = 'Pendiente' OR c.estado = 'Confirmada')
      ORDER BY 
        c.fecha_consulta ASC
      LIMIT 4;
    `;

    db.query(query, (err, results) => {
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

// Endpoint para obtener métricas de resumen
router.get("/metricas-resumen", async (req, res) => {
  try {
    // Consulta para obtener citas de hoy
    const queryCitasHoy = `
      SELECT COUNT(*) AS total
      FROM citas
      WHERE DATE(fecha_consulta) = CURRENT_DATE()
      AND (estado = 'Pendiente' OR estado = 'Confirmada');
    `;
    
    // Consulta para obtener citas de la semana
    const queryCitasSemana = `
      SELECT COUNT(*) AS total
      FROM citas
      WHERE fecha_consulta BETWEEN 
        DATE_SUB(CURRENT_DATE(), INTERVAL WEEKDAY(CURRENT_DATE()) DAY) 
        AND DATE_ADD(DATE_SUB(CURRENT_DATE(), INTERVAL WEEKDAY(CURRENT_DATE()) DAY), INTERVAL 6 DAY)
      AND (estado = 'Pendiente' OR estado = 'Confirmada');
    `;
    
    // Consulta para obtener nuevos pacientes de este mes
    const queryNuevosPacientes = `
      SELECT COUNT(*) AS total
      FROM pacientes
      WHERE MONTH(fecha_creacion) = MONTH(CURRENT_DATE())
      AND YEAR(fecha_creacion) = YEAR(CURRENT_DATE());
    `;
    
    // Consulta para obtener ingresos de la semana
    const queryIngresosSemana = `
      SELECT SUM(monto) AS total
      FROM pagos
      WHERE fecha_pago BETWEEN 
        DATE_SUB(CURRENT_DATE(), INTERVAL WEEKDAY(CURRENT_DATE()) DAY) 
        AND DATE_ADD(DATE_SUB(CURRENT_DATE(), INTERVAL WEEKDAY(CURRENT_DATE()) DAY), INTERVAL 6 DAY)
      AND estado = 'Pagado';
    `;
    
    // Consulta para calcular tasa de ocupación (citas programadas / capacidad total) * 100
    const queryTasaOcupacion = `
      SELECT
        (COUNT(*) / (SELECT COUNT(*) * 10 FROM servicios)) * 100 AS tasa
      FROM
        citas
      WHERE
        fecha_consulta BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND CURRENT_DATE();
    `;
    
    // Ejecutar todas las consultas
    db.query(queryCitasHoy, (err, citasHoyResults) => {
      if (err) {
        console.error("Error al obtener citas de hoy:", err);
        return res.status(500).json({ error: "Error interno del servidor" });
      }
      
      db.query(queryCitasSemana, (err, citasSemanaResults) => {
        if (err) {
          console.error("Error al obtener citas de la semana:", err);
          return res.status(500).json({ error: "Error interno del servidor" });
        }
        
        db.query(queryNuevosPacientes, (err, nuevosPacientesResults) => {
          if (err) {
            console.error("Error al obtener nuevos pacientes:", err);
            return res.status(500).json({ error: "Error interno del servidor" });
          }
          
          db.query(queryIngresosSemana, (err, ingresosSemanaResults) => {
            if (err) {
              console.error("Error al obtener ingresos de la semana:", err);
              return res.status(500).json({ error: "Error interno del servidor" });
            }
            
            db.query(queryTasaOcupacion, (err, tasaOcupacionResults) => {
              if (err) {
                console.error("Error al obtener tasa de ocupación:", err);
                return res.status(500).json({ error: "Error interno del servidor" });
              }
              
              // Combinar resultados
              res.json({
                citas_hoy: citasHoyResults[0].total || 0,
                citas_semana: citasSemanaResults[0].total || 0,
                nuevos_pacientes: nuevosPacientesResults[0].total || 0,
                ingresos_semana: ingresosSemanaResults[0].total || 0,
                tasa_ocupacion: Math.round(tasaOcupacionResults[0].tasa) || 0
              });
            });
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
