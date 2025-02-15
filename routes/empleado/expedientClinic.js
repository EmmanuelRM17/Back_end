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
        console.log("Respuesta paciente:", paciente); // Verifica la respuesta completa

        if (!paciente.length) {
            return res.status(404).json({ message: "Paciente no encontrado" });
        }

        // Obtener el historial médico del paciente
        const historialQuery = "SELECT * FROM historial_medico WHERE paciente_id = ?";
        const [historial] = await db.query(historialQuery, [id]);
        console.log("Historial:", historial); // Verifica la respuesta completa

        // Obtener los tratamientos de seguimiento del paciente
        const tratamientosQuery = "SELECT * FROM seguimiento_tratamientos WHERE paciente_id = ?";
        const [tratamientos] = await db.query(tratamientosQuery, [id]);
        console.log("Tratamientos:", tratamientos); // Verifica la respuesta completa

        // Obtener las recetas médicas del paciente
        const recetasQuery = "SELECT * FROM recetas_medicas WHERE paciente_id = ?";
        const [recetas] = await db.query(recetasQuery, [id]);
        console.log("Recetas:", recetas); // Verifica la respuesta completa

        // Retornar los datos del expediente clínico
        res.json({
            paciente: paciente[0], // Asegúrate de que solo estás enviando el primer registro si es un array
            historial: historial.length > 0 ? historial : null,
            tratamientos: tratamientos.length > 0 ? tratamientos : null,
            recetas: recetas.length > 0 ? recetas : null
        });
    } catch (error) {
        console.error("Error obteniendo el expediente clínico:", error);
        res.status(500).json({ message: "Error en el servidor" });
    }
});

module.exports = router;
