const express = require('express');
const db = require('../db'); // Asegúrate de que la ruta a tu conexión de base de datos sea correcta
const router = express.Router();

// Ruta para insertar un nuevo término o condición
router.post('/insert', async (req, res) => {
    const { titulo, contenido } = req.body;

    if (!titulo || !contenido) {
        return res.status(400).send('Título y contenido son obligatorios.');
    }

    try {
        // Desactivar todos los términos actuales antes de insertar uno nuevo
        await db.promise().query(`UPDATE inf_terminos_condiciones SET estado = 'inactivo'`);

        // Determinar el número de la próxima versión principal
        const [result] = await db.promise().query(`
            SELECT MAX(CAST(version AS DECIMAL(5, 1))) AS max_version 
            FROM inf_terminos_condiciones
        `);

        let newVersion;
        if (result[0].max_version === null) {
            // Si no existen términos, la primera versión será "1.0"
            newVersion = "1.0";
        } else {
            // Si existen términos, incrementar la versión principal
            const nextVersionNumber = Math.floor(result[0].max_version) + 1;
            newVersion = `${nextVersionNumber}.0`;
        }

        // Insertar el nuevo término con versión incrementada y estado activo
        const insertQuery = `
            INSERT INTO inf_terminos_condiciones (numero_termino, titulo, contenido, estado, version, fecha_creacion, fecha_actualizacion)
            VALUES (0, ?, ?, 'activo', ?, NOW(), NOW())
        `;
        await db.promise().query(insertQuery, [titulo, contenido, newVersion]);

        res.status(200).send('Término insertado con éxito.');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al insertar el término.');
    }
});

// Ruta para actualizar un término existente
router.put('/update/:id', async (req, res) => {
    const { id } = req.params;
    const { titulo, contenido } = req.body;

    if (!titulo || !contenido) {
        return res.status(400).send('Título y contenido son obligatorios.');
    }

    try {
        // Obtener la versión actual del término específico a actualizar
        const getTermQuery = `SELECT version FROM inf_terminos_condiciones WHERE id = ?`;
        const [term] = await db.promise().query(getTermQuery, [id]);

        if (term.length === 0) {
            return res.status(404).send('Término no encontrado.');
        }

        const currentVersion = parseFloat(term[0].version);
        const newVersion = (currentVersion + 0.1).toFixed(1); // Nueva versión aumentada en 0.1

        // Desactivar el término actual antes de insertar la nueva versión
        await db.promise().query(`UPDATE inf_terminos_condiciones SET estado = 'inactivo' WHERE id = ?`, [id]);

        // Insertar nuevo término con versión incrementada y estado activo
        const insertQuery = `
            INSERT INTO inf_terminos_condiciones (numero_termino, titulo, contenido, estado, version, fecha_creacion, fecha_actualizacion)
            VALUES (0, ?, ?, 'activo', ?, NOW(), NOW())
        `;
        await db.promise().query(insertQuery, [titulo, contenido, newVersion]);

        res.status(200).send('Término actualizado correctamente.');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al actualizar el término.');
    }
});


// Ruta para obtener un término específico por ID
router.get('/get/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await db.promise().query(`SELECT * FROM inf_terminos_condiciones WHERE id = ?`, [id]);
        if (result.length === 0) {
            return res.status(404).send('Término no encontrado.');
        }
        res.status(200).json(result[0]);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al obtener el término.');
    }
});

// Ruta para eliminar lógicamente un término de condiciones
router.put('/deactivate/:id', (req, res) => {
    const { id } = req.params;

    const query = 'UPDATE inf_terminos_condiciones SET estado = ? WHERE id = ?';

    db.promise().query(query, ['inactivo', id])
        .then(() => {
            res.status(200).send('Término de condiciones eliminado (lógicamente) con éxito');
        })
        .catch(err => {
            console.log(err);
            res.status(500).send('Error en el servidor');
        });
});

// Ruta para obtener el término activo más reciente
router.get('/gettermino', (req, res) => {
    const query = 'SELECT * FROM inf_terminos_condiciones WHERE estado = "activo" ORDER BY version DESC LIMIT 1';

    db.promise().query(query)
        .then(([results]) => {
            if (results.length === 0) {
                return res.status(404).json({ message: 'No hay términos activos' });
            }
            res.status(200).json(results[0]);  // Devolver solo el término más reciente
        })
        .catch(err => {
            console.log(err);
            res.status(500).send('Error en el servidor');
        });
});

// Ruta para obtener todos los términos (activos e inactivos)
router.get('/getAllTerminos', (req, res) => {
    const query = 'SELECT * FROM inf_terminos_condiciones ORDER BY numero_termino, CAST(version AS DECIMAL(5,1)) ASC';

    db.promise().query(query)
        .then(([results]) => {
            res.status(200).json(results);
        })
        .catch(err => {
            console.log(err);
            res.status(500).send('Error en el servidor');
        });
});
// Endpoint para obtener los términos y condiciones activos
router.get('/terminos_condiciones', (req, res) => {
    const sql = 'SELECT * FROM inf_terminos_condiciones WHERE estado = "activo"';
    db.query(sql, (err, result) => {
      if (err) {
        return res.status(500).json({ message: 'Error al obtener los términos y condiciones.' });
      }
      res.status(200).json(result);
    });
  });
  
module.exports = router;
