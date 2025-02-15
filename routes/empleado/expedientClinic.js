const express = require("express");
const router = express.Router();
const db = require("../../db");

// Obtener el historial médico de un paciente por su ID
router.get("/:id", async (req, res) => {
    const { id } = req.params;  // Obtener el ID del paciente desde los parámetros de la URL

    try {
        // Validar si el ID es un número válido
        if (isNaN(id)) {
            return res.status(400).json({ message: "El ID del paciente debe ser un número válido" });
        }

        // Obtener los datos del historial médico del paciente usando paciente_id como clave foránea
        const historialQuery = `
            SELECT 
                hm.id, 
                hm.paciente_id, 
                hm.cita_id, 
                hm.fecha_registro, 
                hm.enfermedades_previas, 
                hm.tratamientos_recientes
            FROM historial_medico hm
            WHERE hm.paciente_id = ?
        `;

        const [historial] = await db.query(historialQuery, [id]);

        // Verificar si no hay historial para este paciente
        if (!historial.length) {
            return res.status(404).json({ message: "Historial médico no encontrado para este paciente" });
        }

        // Retornar los datos del historial médico
        return res.json({
            historial
        });

    } catch (error) {
        console.error("Error obteniendo el historial médico:", error);
        // Responder con un mensaje más detallado de error
        return res.status(500).json({
            message: "Error en el servidor",
            error: error.message  // Añadido para mostrar el error exacto
        });
    }
});

module.exports = router;
