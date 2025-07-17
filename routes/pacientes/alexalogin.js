const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const db = require("../db");
const xss = require("xss");
const { RateLimiterMemory } = require("rate-limiter-flexible");
const logger = require("../utils/logger");
const cookieParser = require("cookie-parser");

router.use(cookieParser());

// Función para generar un token aleatorio seguro
function generateToken() {
  return crypto.randomBytes(64).toString("hex");
}

// Protección contra ataques de fuerza bruta
const rateLimiter = new RateLimiterMemory({
  points: 100,
  duration: 3 * 60 * 60, // 3 horas
});

// Función para obtener valores de configuración de la tabla config
async function getConfigValue(settingName) {
  return new Promise((resolve, reject) => {
    const query = "SELECT setting_value FROM config WHERE setting_name = ?";
    db.query(query, [settingName], (err, result) => {
      if (err) {
        reject(err);
      } else if (result.length === 0) {
        reject(new Error("Configuración no encontrada"));
      } else {
        resolve(parseInt(result[0].setting_value, 10));
      }
    });
  });
}

// Endpoint de login para pacientes usando solo teléfono
router.post("/loginalexa", async (req, res) => {
  try {
    const telefono = xss(req.body.telefono); // Sanitizar input
    const ipAddress = req.ip;

    // Verificar el límite de IP con el rate limiter
    try {
      await rateLimiter.consume(ipAddress);
    } catch {
      logger.error(`Demasiados intentos desde la IP: ${ipAddress}`);
      return res
        .status(429)
        .json({ message: "Demasiados intentos. Inténtalo más tarde." });
    }

    if (!telefono) {
      return res
        .status(400)
        .json({ message: "Proporciona un número de teléfono." });
    }

    // Consultar paciente por teléfono
    const checkUserSql = "SELECT * FROM pacientes WHERE telefono = ?";
    db.query(checkUserSql, [telefono], async (err, resultPaciente) => {
      if (err) {
        logger.error(`Error al verificar teléfono: ${err.message}`);
        return res
          .status(500)
          .json({ message: "Error al verificar teléfono." });
      }

      if (resultPaciente.length === 0) {
        return res.status(404).json({ message: "Teléfono no registrado." });
      }

      const paciente = resultPaciente[0];

      // Verificar intentos fallidos
      const checkAttemptsSql = `
        SELECT * FROM inf_login_attempts
        WHERE paciente_id = ? AND ip_address = ?
        ORDER BY fecha_hora DESC LIMIT 1
      `;

      db.query(
        checkAttemptsSql,
        [paciente.id, ipAddress],
        async (err, attemptsResult) => {
          if (err) {
            return res
              .status(500)
              .json({ message: "Error al verificar intentos fallidos." });
          }

          const now = new Date();
          const lastAttempt = attemptsResult[0];

          // Obtener valores de configuración desde la base de datos
          const MAX_ATTEMPTS = await getConfigValue("MAX_ATTEMPTS");
          const LOCK_TIME_MINUTES = await getConfigValue("LOCK_TIME_MINUTES");

          // Verificar si está bloqueado
          if (lastAttempt && lastAttempt.fecha_bloqueo) {
            const fechaBloqueo = new Date(lastAttempt.fecha_bloqueo);
            if (now < fechaBloqueo) {
              return res.status(429).json({
                message: `Cuenta bloqueada hasta ${fechaBloqueo.toLocaleString()}.`,
                lockStatus: true,
                lockUntil: fechaBloqueo,
              });
            }
          }

          // Si no hay intentos previos o el último fue exitoso, proceder
          const failedAttempts = lastAttempt ? lastAttempt.intentos_fallidos : 0;

          if (failedAttempts >= MAX_ATTEMPTS) {
            const bloqueo = new Date(now.getTime() + LOCK_TIME_MINUTES * 60 * 1000);
            const newFechaBloqueo = bloqueo.toISOString();

            const attemptSql = lastAttempt
              ? `UPDATE inf_login_attempts SET intentos_fallidos = ?, fecha_bloqueo = ?, fecha_hora = ? WHERE paciente_id = ? AND ip_address = ?`
              : `INSERT INTO inf_login_attempts (paciente_id, ip_address, exitoso, intentos_fallidos, fecha_bloqueo, fecha_hora) VALUES (?, ?, 0, ?, ?, ?)`;

            const params = lastAttempt
              ? [failedAttempts + 1, newFechaBloqueo, now.toISOString(), paciente.id, ipAddress]
              : [paciente.id, ipAddress, 1, newFechaBloqueo, now.toISOString()];

            db.query(attemptSql, params, (err) => {
              if (err) {
                return res
                  .status(500)
                  .json({ message: "Error al registrar intento fallido." });
              }
            });

            return res.status(429).json({
              message: `Cuenta bloqueada hasta ${newFechaBloqueo}.`,
              lockStatus: true,
              lockUntil: newFechaBloqueo,
            });
          }

          // Generar token y actualizar la base de datos
          const sessionToken = generateToken();
          const updateTokenSql = `UPDATE pacientes SET cookie = ? WHERE id = ?`;

          db.query(updateTokenSql, [sessionToken, paciente.id], (err) => {
            if (err) {
              return res.status(500).json({ message: "Error en el servidor." });
            }

            // Configuración de cookie para paciente
            const cookieName = "carolDental_paciente";

            res.cookie(cookieName, sessionToken, {
              httpOnly: true,
              secure: process.env.NODE_ENV === "production",
              sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
              path: "/",
              maxAge: 24 * 60 * 60 * 1000,
            });

            // Actualizar o insertar intento exitoso
            const attemptSql = lastAttempt
              ? `UPDATE inf_login_attempts SET exitoso = 1, intentos_fallidos = 0, fecha_bloqueo = NULL, fecha_hora = ? WHERE paciente_id = ? AND ip_address = ?`
              : `INSERT INTO inf_login_attempts (paciente_id, ip_address, exitoso, intentos_fallidos, fecha_bloqueo, fecha_hora) VALUES (?, ?, 1, 0, NULL, ?)`;

            db.query(attemptSql, [now.toISOString(), paciente.id, ipAddress], (err) => {
              if (err) {
                logger.error(`Error al registrar intento exitoso: ${err.message}`);
              }
            });

            return res.status(200).json({
              message: "Inicio de sesión exitoso",
              user: {
                nombre: paciente.nombre,
                telefono: paciente.telefono,
                email: paciente.email,
                tipo: "paciente",
                token: sessionToken,
              },
            });
          });
        }
      );
    });
  } catch (error) {
    logger.error(`Error en /login: ${error.message}`);
    res.status(500).json({ message: "Error del servidor." });
  }
});

module.exports = router;