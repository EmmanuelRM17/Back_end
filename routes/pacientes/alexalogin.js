const express = require("express");
const router = express.Router();
const db = require("../../db");
const xss = require("xss");

// Ruta POST: /loginalexa
router.post("/loginalexa", (req, res) => {
  const telefono = xss(req.body.telefono); // sanitiza input

  if (!telefono) {
    return res.status(400).json({ message: "Proporciona un número de teléfono." });
  }

  const sql = "SELECT * FROM pacientes WHERE telefono = ?";
  db.query(sql, [telefono], (err, result) => {
    if (err) {
      return res.status(500).json({ message: "Error del servidor." });
    }

    if (result.length === 0) {
      return res.status(404).json({ message: "Teléfono no registrado." });
    }

    const paciente = result[0];

    return res.status(200).json({
      message: "Inicio de sesión exitoso",
      user: {
        nombre: paciente.nombre,
        telefono: paciente.telefono,
        email: paciente.email,
        tipo: "paciente"
      }
    });
  });
});

module.exports = router;
