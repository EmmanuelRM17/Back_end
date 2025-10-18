const express = require("express");
const router = express.Router();
const db = require("../../db");

// ==================== RECOMPENSAS ====================

// Obtener todas las recompensas
router.get("/recompensas", (req, res) => {
  const query = `
    SELECT * FROM gamificacion_recompensa 
    ORDER BY orden ASC, puntos_requeridos ASC
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error al obtener recompensas:", err);
      return res.status(500).json({ error: "Error al obtener recompensas" });
    }
    res.status(200).json(results);
  });
});

// Obtener recompensas activas
router.get("/recompensas/activas", (req, res) => {
  const query = `
    SELECT * FROM gamificacion_recompensa 
    WHERE estado = 1 
    ORDER BY orden ASC, puntos_requeridos ASC
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error al obtener recompensas activas:", err);
      return res.status(500).json({ error: "Error al obtener recompensas" });
    }
    res.status(200).json(results);
  });
});

// Crear recompensa
router.post("/recompensas", (req, res) => {
  const { nombre, descripcion, tipo, puntos_requeridos, icono, premio, orden } = req.body;
  
  if (!nombre || !tipo || !puntos_requeridos) {
    return res.status(400).json({ error: "Faltan datos requeridos" });
  }
  
  const query = `
    INSERT INTO gamificacion_recompensa 
    (nombre, descripcion, tipo, puntos_requeridos, icono, premio, orden, estado) 
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `;
  
  db.query(query, [nombre, descripcion, tipo, puntos_requeridos, icono, premio, orden || 0], (err, result) => {
    if (err) {
      console.error("Error al crear recompensa:", err);
      return res.status(500).json({ error: "Error al crear recompensa" });
    }
    res.status(201).json({ message: "Recompensa creada", id: result.insertId });
  });
});

// Editar recompensa
router.put("/recompensas/:id", (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion, tipo, puntos_requeridos, icono, premio, orden, estado } = req.body;
  
  const query = `
    UPDATE gamificacion_recompensa 
    SET nombre = ?, descripcion = ?, tipo = ?, puntos_requeridos = ?, 
        icono = ?, premio = ?, orden = ?, estado = ?
    WHERE id = ?
  `;
  
  db.query(query, [nombre, descripcion, tipo, puntos_requeridos, icono, premio, orden, estado, id], (err, result) => {
    if (err) {
      console.error("Error al editar recompensa:", err);
      return res.status(500).json({ error: "Error al editar recompensa" });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Recompensa no encontrada" });
    }
    
    res.status(200).json({ message: "Recompensa actualizada" });
  });
});

// Eliminar recompensa
router.delete("/recompensas/:id", (req, res) => {
  const { id } = req.params;
  
  const query = "DELETE FROM gamificacion_recompensa WHERE id = ?";
  
  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error al eliminar recompensa:", err);
      return res.status(500).json({ error: "Error al eliminar recompensa" });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Recompensa no encontrada" });
    }
    
    res.status(200).json({ message: "Recompensa eliminada" });
  });
});

// ==================== SERVICIOS GAMIFICACIÓN ====================

// Obtener todos los servicios con puntos asignados
router.get("/servicios-gamificacion", (req, res) => {
  const query = `
    SELECT 
      gs.id,
      gs.id_servicio,
      gs.puntos,
      gs.estado,
      gs.fecha_creacion,
      s.title as nombre_servicio,
      s.description as descripcion_servicio,
      s.price as precio_servicio
    FROM gamificacion_servicios gs
    INNER JOIN servicios s ON gs.id_servicio = s.id
    ORDER BY gs.estado DESC, s.title ASC
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error al obtener servicios gamificación:", err);
      return res.status(500).json({ error: "Error al obtener servicios" });
    }
    res.status(200).json(results);
  });
});

// Obtener solo servicios activos en gamificación
router.get("/servicios-gamificacion/activos", (req, res) => {
  const query = `
    SELECT 
      gs.id,
      gs.id_servicio,
      gs.puntos,
      gs.estado,
      s.title as nombre_servicio,
      s.description as descripcion_servicio
    FROM gamificacion_servicios gs
    INNER JOIN servicios s ON gs.id_servicio = s.id
    WHERE gs.estado = 1
    ORDER BY s.title ASC
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error al obtener servicios activos:", err);
      return res.status(500).json({ error: "Error al obtener servicios" });
    }
    res.status(200).json(results);
  });
});

// Obtener servicios disponibles (sin puntos asignados)
router.get("/servicios/disponibles", (req, res) => {
  const query = `
    SELECT 
      s.id,
      s.title as nombre,
      s.description as descripcion,
      s.price as precio
    FROM servicios s
    WHERE s.id NOT IN (SELECT id_servicio FROM gamificacion_servicios)
    ORDER BY s.title ASC
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error al obtener servicios disponibles:", err);
      return res.status(500).json({ error: "Error al obtener servicios" });
    }
    res.status(200).json(results);
  });
});

// Asignar puntos a un servicio (crear asociación)
router.post("/servicios-gamificacion", (req, res) => {
  const { id_servicio, puntos } = req.body;
  
  if (!id_servicio || !puntos) {
    return res.status(400).json({ error: "Faltan datos requeridos" });
  }
  
  if (puntos <= 0) {
    return res.status(400).json({ error: "Los puntos deben ser mayores a 0" });
  }
  
  // Verificar que el servicio existe
  const queryCheckServicio = "SELECT id FROM servicios WHERE id = ?";
  
  db.query(queryCheckServicio, [id_servicio], (err, results) => {
    if (err) {
      console.error("Error al verificar servicio:", err);
      return res.status(500).json({ error: "Error al verificar servicio" });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ error: "Servicio no encontrado" });
    }
    
    // Verificar que no esté ya asignado
    const queryCheckAsignado = "SELECT id FROM gamificacion_servicios WHERE id_servicio = ?";
    
    db.query(queryCheckAsignado, [id_servicio], (err, results) => {
      if (err) {
        console.error("Error al verificar asignación:", err);
        return res.status(500).json({ error: "Error al verificar asignación" });
      }
      
      if (results.length > 0) {
        return res.status(400).json({ error: "Este servicio ya tiene puntos asignados" });
      }
      
      // Insertar en gamificacion_servicios
      const queryInsert = `
        INSERT INTO gamificacion_servicios (id_servicio, puntos, estado) 
        VALUES (?, ?, 1)
      `;
      
      db.query(queryInsert, [id_servicio, puntos], (err, result) => {
        if (err) {
          console.error("Error al asignar puntos:", err);
          return res.status(500).json({ error: "Error al asignar puntos" });
        }
        res.status(201).json({ 
          message: "Puntos asignados correctamente", 
          id: result.insertId 
        });
      });
    });
  });
});

// Editar puntos de un servicio
router.put("/servicios-gamificacion/:id", (req, res) => {
  const { id } = req.params;
  const { puntos, estado } = req.body;
  
  if (!puntos && estado === undefined) {
    return res.status(400).json({ error: "Debe proporcionar puntos o estado" });
  }
  
  if (puntos && puntos <= 0) {
    return res.status(400).json({ error: "Los puntos deben ser mayores a 0" });
  }
  
  const query = `
    UPDATE gamificacion_servicios 
    SET puntos = ?, estado = ?
    WHERE id = ?
  `;
  
  db.query(query, [puntos, estado, id], (err, result) => {
    if (err) {
      console.error("Error al editar servicio:", err);
      return res.status(500).json({ error: "Error al editar servicio" });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Servicio no encontrado" });
    }
    
    res.status(200).json({ message: "Servicio actualizado correctamente" });
  });
});

// Eliminar asociación de servicio (quitar de gamificación)
router.delete("/servicios-gamificacion/:id", (req, res) => {
  const { id } = req.params;
  
  const query = "DELETE FROM gamificacion_servicios WHERE id = ?";
  
  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error al eliminar servicio:", err);
      return res.status(500).json({ error: "Error al eliminar servicio" });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Servicio no encontrado" });
    }
    
    res.status(200).json({ message: "Servicio eliminado de gamificación" });
  });
});

// ==================== PACIENTES GAMIFICACIÓN ====================

// Obtener todos los pacientes con sus puntos
router.get("/pacientes-gamificacion", (req, res) => {
  const query = `
    SELECT 
      gp.id,
      gp.id_paciente,
      gp.puntos_disponibles,
      gp.puntos_totales,
      gp.descuento,
      gp.nivel,
      gp.fecha_actualizacion,
      gp.estado,
      CONCAT(p.nombre, ' ', p.aPaterno, ' ', p.aMaterno) as nombre_completo,
      p.email,
      p.telefono
    FROM gamificacion_paciente gp
    INNER JOIN pacientes p ON gp.id_paciente = p.id
    WHERE gp.estado = 1
    ORDER BY gp.puntos_disponibles DESC
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error al obtener pacientes:", err);
      return res.status(500).json({ error: "Error al obtener pacientes" });
    }
    res.status(200).json(results);
  });
});

// ==================== PUNTOS PACIENTE ====================

// Obtener saldo del paciente
router.get("/paciente/:id", (req, res) => {
  const { id } = req.params;
  
  const query = `
    SELECT * FROM gamificacion_paciente 
    WHERE id_paciente = ? AND estado = 1
  `;
  
  db.query(query, [id], (err, results) => {
    if (err) {
      console.error("Error al obtener puntos:", err);
      return res.status(500).json({ error: "Error al obtener puntos" });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ error: "Paciente no encontrado en gamificación" });
    }
    
    res.status(200).json(results[0]);
  });
});

module.exports = router;