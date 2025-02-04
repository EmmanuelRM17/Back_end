const express = require("express");
const router = express.Router();
const db = require("../../db"); // Importa la conexión a la base de datos

// Endpoint para obtener el perfil del paciente por ID y email
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { email } = req.query; // Obtener el email desde query params

        if (!id || !email) {
            return res.status(400).json({ message: "ID y email son requeridos." });
        }

        // Buscar al paciente por ID y email
        const query = `
            SELECT id, nombre, aPaterno, aMaterno, fechaNacimiento, tipoTutor, 
                   nombreTutor, genero, lugar, telefono, email, alergias 
            FROM pacientes 
            WHERE id = ? AND email = ?
        `;

        db.query(query, [id, email], (err, results) => {
            if (err) {
                console.error("Error al obtener perfil:", err);
                return res.status(500).json({ message: "Error en el servidor." });
            }

            if (results.length === 0) {
                return res.status(404).json({ message: "Perfil no encontrado." });
            }

            return res.json(results[0]); // Devuelve el perfil del paciente
        });
    } catch (error) {
        console.error("Error en /profile/:id:", error);
        res.status(500).json({ message: "Error en el servidor." });
    }
});

module.exports = router;
