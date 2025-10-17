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

// Inicializar gamificación para paciente
router.post("/paciente/inicializar", (req, res) => {
  const { id_paciente } = req.body;
  
  if (!id_paciente) {
    return res.status(400).json({ error: "ID de paciente requerido" });
  }
  
  const queryCheck = "SELECT id FROM gamificacion_paciente WHERE id_paciente = ?";
  
  db.query(queryCheck, [id_paciente], (err, results) => {
    if (err) {
      console.error("Error al verificar paciente:", err);
      return res.status(500).json({ error: "Error al verificar paciente" });
    }
    
    if (results.length > 0) {
      return res.status(400).json({ error: "Paciente ya tiene gamificación activa" });
    }
    
    const queryInsert = `
      INSERT INTO gamificacion_paciente 
      (id_paciente, puntos_disponibles, puntos_totales, descuento, nivel, estado) 
      VALUES (?, 0, 0, 0, 1, 1)
    `;
    
    db.query(queryInsert, [id_paciente], (err, result) => {
      if (err) {
        console.error("Error al inicializar gamificación:", err);
        return res.status(500).json({ error: "Error al inicializar gamificación" });
      }
      res.status(201).json({ message: "Gamificación inicializada", id: result.insertId });
    });
  });
});




module.exports = router;