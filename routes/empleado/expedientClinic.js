const express = require("express");
const router = express.Router();
const db = require("../../db");

// Obtener el expediente clínico de un paciente por su ID
router.get("/paciente/:id", async (req, res) => {
    const { id } = req.params;
    try {
        // Obtener la información del paciente
        const pacienteQuery = "SELECT * FROM pacientes WHERE id = ?";
        const [paciente] = await db.query(pacienteQuery, [id]);

        if (!paciente.length) {
            return res.status(404).json({ message: "Paciente no encontrado" });
        }

        // Obtener el historial médico del paciente
        const historialQuery = "SELECT * FROM historial_medico WHERE paciente_id = ?";
        const [historial] = await db.query(historialQuery, [id]);

        // Obtener los tratamientos de seguimiento del paciente
        const tratamientosQuery = "SELECT * FROM seguimiento_tratamientos WHERE paciente_id = ?";
        const [tratamientos] = await db.query(tratamientosQuery, [id]);

        // Obtener las recetas médicas del paciente
        const recetasQuery = "SELECT * FROM recetas_medicas WHERE paciente_id = ?";
        const [recetas] = await db.query(recetasQuery, [id]);

        // Retornar los datos del expediente clínico
        res.json({
            paciente: paciente[0],
            historial,
            tratamientos,
            recetas
        });
    } catch (error) {
        console.error("Error obteniendo el expediente clínico:", error);
        res.status(500).json({ message: "Error en el servidor" });
    }
});

module.exports = router;
