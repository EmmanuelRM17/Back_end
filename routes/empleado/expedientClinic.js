const express = require("express");
const router = express.Router();
const db = require("../../db");

// Obtener el historial médico de un paciente por su ID
// Ejemplo de ruta para obtener el historial médico de un paciente por ID
router.get("/:paciente_id", async (req, res) => {
    try {
        const { paciente_id } = req.params;

        if (!paciente_id) {
            return res.status(400).json({ message: "El ID del paciente es requerido." });
        }

        const query = `
            SELECT id, paciente_id, cita_id, fecha_registro, enfermedades_previas, tratamientos_recientes 
            FROM historial_medico 
            WHERE paciente_id = ?
        `;

        db.query(query, [paciente_id], (err, results) => {
            if (err) {
                console.error("Error al obtener el historial médico:", err);
                return res.status(500).json({ message: "Error en el servidor." });
            }

            if (results.length === 0) {
                return res.status(404).json({ message: "Historial médico no encontrado." });
            }

            return res.json(results); // Devuelve el historial médico del paciente
        });
    } catch (error) {
        console.error("Error en /historial/:paciente_id:", error);
        res.status(500).json({ message: "Error en el servidor." });
    }
});


module.exports = router;
