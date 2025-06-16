const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../db");
const axios = require("axios");
const xss = require("xss");
const { RateLimiterMemory } = require("rate-limiter-flexible");
const logger = require("../utils/logger");
const cookieParser = require("cookie-parser");

router.use(cookieParser()); // Configuración de cookie-parser

// Función para generar un token aleatorio seguro
function generateToken() {
  return crypto.randomBytes(64).toString("hex");
}

// Protección contra ataques de fuerza bruta
const rateLimiter = new RateLimiterMemory({
  points: 100,
  duration: 3 * 60 * 60,
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
        resolve(parseInt(result[0].setting_value, 10)); // Parsear el valor como entero
      }
    });
  });
}

// Endpoint de login
router.post("/login", async (req, res) => {
  try {
    const email = xss(req.body.email); // Sanitizar input
    const password = xss(req.body.password);
    const captchaValue = req.body.captchaValue;
    const ipAddress = req.ip;

    // Obtener valores de configuración desde la base de datos
    const MAX_ATTEMPTS = await getConfigValue("MAX_ATTEMPTS");
    const LOCK_TIME_MINUTES = await getConfigValue("LOCK_TIME_MINUTES");

    // Verificar el límite de IP con el rate limiter
    try {
      await rateLimiter.consume(ipAddress);
    } catch {
      logger.error(`Demasiados intentos desde la IP: ${ipAddress}`);
      return res
        .status(429)
        .json({ message: "Demasiados intentos. Inténtalo más tarde." });
    }

    if (!captchaValue) {
      logger.warn(`Captcha no completado en la IP: ${ipAddress}`);
      return res.status(400).json({ message: "Captcha no completado." });
    }

    try {
      // Verificar CAPTCHA
      const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=6Lc74mAqAAAAAKQ5XihKY-vB3oqpf6uYgEWy4A1k&response=${captchaValue}`;
      const captchaResponse = await axios.post(verifyUrl);

      if (!captchaResponse.data.success) {
        logger.warn(`Captcha inválido en la IP: ${ipAddress}`);
        return res.status(400).json({ message: "Captcha inválido." });
      }

      if (!email || !password) {
        return res
          .status(400)
          .json({ message: "Proporciona correo y contraseña." });
      }

      // Verificar si es administrador, paciente o empleado
      const checkAdminSql = "SELECT * FROM administradores WHERE email = ?";
      db.query(checkAdminSql, [email], async (err, resultAdmin) => {
        if (err) {
          logger.error(`Error al verificar correo: ${err.message}`);
          return res
            .status(500)
            .json({ message: "Error al verificar correo." });
        }

        if (resultAdmin.length > 0) {
          const administrador = resultAdmin[0];
          return autenticarUsuario(
            administrador,
            ipAddress,
            password,
            "administrador",
            res,
            MAX_ATTEMPTS,
            LOCK_TIME_MINUTES
          );
        }
        // Consultar Empleados
        const checkEmpleadoSql = "SELECT * FROM empleados WHERE email = ?";
        db.query(checkEmpleadoSql, [email], async (err, resultEmpleado) => {
          if (err) {
            logger.error(`Error al verificar correo del empleado: ${err.message}`);
            return res.status(500).json({ message: "Error al verificar correo." });
          }

          if (resultEmpleado.length > 0) {
            const empleado = resultEmpleado[0];
            return autenticarUsuario(
              empleado,
              ipAddress,
              password,
              "empleado",
              res,
              MAX_ATTEMPTS,
              LOCK_TIME_MINUTES
            );
          }
          const checkUserSql = "SELECT * FROM pacientes WHERE email = ?";
          db.query(checkUserSql, [email], async (err, resultPaciente) => {
            if (err) {
              logger.error(
                `Error al verificar correo del paciente: ${err.message}`
              );
              return res
                .status(500)
                .json({ message: "Error al verificar correo." });
            }

            if (resultPaciente.length === 0) {
              return res.status(404).json({ message: "Correo no registrado." });
            }

            const paciente = resultPaciente[0];
            return autenticarUsuario(
              paciente,
              ipAddress,
              password,
              "paciente",
              res,
              MAX_ATTEMPTS,
              LOCK_TIME_MINUTES
            );
          });
        });
      });
    } catch (error) {
      logger.error(`Error en verificación del captcha: ${error.message}`);
      return res.status(500).json({ message: "Error en la autenticación." });
    }
  } catch (error) {
    logger.error(`Error en /login: ${error.message}`);
    res.status(500).json({ message: "Error del servidor." });
  }
});

// Función para autenticar usuarios
async function autenticarUsuario(
  usuario,
  ipAddress,
  password,
  tipoUsuario,
  res,
  MAX_ATTEMPTS,
  LOCK_TIME_MINUTES
) {
  const checkAttemptsSql = `
    SELECT * FROM inf_login_attempts
    WHERE ${tipoUsuario === "administrador" ? "administrador_id" :
      tipoUsuario === "empleado" ? "empleado_id" : "paciente_id"
    } = ? AND ip_address = ?
    ORDER BY fecha_hora DESC LIMIT 1
`;

  db.query(
    checkAttemptsSql,
    [usuario.id, ipAddress],
    async (err, attemptsResult) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Error al verificar intentos fallidos." });
      }

      const now = new Date();
      const lastAttempt = attemptsResult[0];

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

      // Verificar la contraseña
      const isMatch = await bcrypt.compare(password, usuario.password);
      if (!isMatch) {
        const failedAttempts = lastAttempt
          ? lastAttempt.intentos_fallidos + 1
          : 1;

        let newFechaBloqueo = null;
        if (failedAttempts >= MAX_ATTEMPTS) {
          const bloqueo = new Date(
            now.getTime() + LOCK_TIME_MINUTES * 60 * 1000
          );
          newFechaBloqueo = bloqueo.toISOString();
        }

        // Insertar o actualizar el intento fallido
        const attemptSql = lastAttempt
          ? `UPDATE inf_login_attempts SET intentos_fallidos = ?, fecha_bloqueo = ?, fecha_hora = ? WHERE ${tipoUsuario === "administrador" ? "administrador_id" :
            tipoUsuario === "empleado" ? "empleado_id" : "paciente_id"
          } = ? AND ip_address = ?`
          : `INSERT INTO inf_login_attempts (${tipoUsuario === "administrador" ? "administrador_id" :
            tipoUsuario === "empleado" ? "empleado_id" : "paciente_id"
          }, ip_address, exitoso, intentos_fallidos, fecha_bloqueo, fecha_hora) VALUES (?, ?, 0, ?, ?, ?)`;

        const params = lastAttempt
          ? [
            failedAttempts,
            newFechaBloqueo,
            now.toISOString(),
            usuario.id,
            ipAddress,
          ]
          : [
            usuario.id,
            ipAddress,
            failedAttempts,
            newFechaBloqueo,
            now.toISOString(),
          ];

        db.query(attemptSql, params, (err) => {
          if (err) {
            return res
              .status(500)
              .json({ message: "Error al registrar intento fallido." });
          }
        });

        if (failedAttempts >= MAX_ATTEMPTS) {
          return res.status(429).json({
            message: `Cuenta bloqueada hasta ${newFechaBloqueo}.`,
            lockStatus: true,
            lockUntil: newFechaBloqueo,
          });
        }

        return res.status(401).json({
          message: "Contraseña incorrecta.",
          failedAttempts,
          lockUntil: newFechaBloqueo,
        });
      }

      const sessionToken = generateToken();
      const updateTokenSql = `UPDATE ${tipoUsuario === "administrador" ? "administradores" :
          tipoUsuario === "empleado" ? "empleados" : "pacientes"
        } SET cookie = ? WHERE id = ?`;

      db.query(updateTokenSql, [sessionToken, usuario.id], (err) => {
        if (err) return res.status(500).json({ message: 'Error en el servidor.' });

        // MODIFICACIÓN: Configuración de cookies separadas por rol
        const cookieName = `carolDental_${tipoUsuario === "administrador" ? "admin" : 
                           tipoUsuario === "empleado" ? "empleado" : "paciente"}`;

        res.cookie(cookieName, sessionToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
          path: '/',
          maxAge: 24 * 60 * 60 * 1000
        });

        return res.status(200).json({
          message: 'Inicio de sesión exitoso',
          user: {
            nombre: usuario.nombre,
            email: usuario.email,
            tipo: tipoUsuario,
            token: sessionToken
          }
        });
      });
    }
  );
}

// MODIFICACIÓN: Check-auth que devuelve TODOS los usuarios autenticados
router.get("/check-auth", (req, res) => {
  // Obtener las cookies de los diferentes roles
  const adminToken = req.cookies?.carolDental_admin;
  const pacienteToken = req.cookies?.carolDental_paciente;
  const empleadoToken = req.cookies?.carolDental_empleado;

  // Si no hay ningún token, devolver no autenticado
  if (!adminToken && !pacienteToken && !empleadoToken) {
    return res.status(401).json({ authenticated: false });
  }

  // Objetos para almacenar resultados
  let usuariosAutenticados = {};
  let consultasCompletadas = 0;
  let totalConsultas = 0;

  // Determinar cuántas consultas hacer
  if (adminToken) totalConsultas++;
  if (pacienteToken) totalConsultas++;
  if (empleadoToken) totalConsultas++;

  // Función para verificar si ya completamos todas las consultas
  function verificarCompletado() {
    consultasCompletadas++;
    if (consultasCompletadas === totalConsultas) {
      // Si tenemos usuarios autenticados, devolver el resultado
      if (Object.keys(usuariosAutenticados).length > 0) {
        // Determinar el usuario principal basado en prioridad: admin > empleado > paciente
        let usuarioPrincipal = null;
        let userType = null;

        if (usuariosAutenticados.administrador) {
          usuarioPrincipal = usuariosAutenticados.administrador;
          userType = 'administradores';
        } else if (usuariosAutenticados.empleado) {
          usuarioPrincipal = usuariosAutenticados.empleado;
          userType = 'empleados';
        } else if (usuariosAutenticados.paciente) {
          usuarioPrincipal = usuariosAutenticados.paciente;
          userType = 'pacientes';
        }

        return res.json({
          authenticated: true,
          user: usuarioPrincipal,
          userType: userType,
          // NUEVO: Enviar todos los usuarios autenticados
          allAuthenticatedUsers: usuariosAutenticados
        });
      } else {
        return res.status(401).json({
          authenticated: false,
          message: "Token no válido"
        });
      }
    }
  }

  // Verificar administrador si hay token
  if (adminToken) {
    const queryAdministradores = `
        SELECT id, nombre, email, 'administrador' as tipo
        FROM administradores 
        WHERE cookie = ?
    `;
    
    db.query(queryAdministradores, [adminToken], (err, resultsAdmin) => {
      if (err) {
        console.error("Error al verificar autenticación en administradores:", err);
      } else if (resultsAdmin.length > 0) {
        usuariosAutenticados.administrador = {
          id: resultsAdmin[0].id,
          nombre: resultsAdmin[0].nombre,
          email: resultsAdmin[0].email,
          tipo: resultsAdmin[0].tipo
        };
      }
      verificarCompletado();
    });
  }

  // Verificar empleado si hay token
  if (empleadoToken) {
    const queryEmpleados = `
      SELECT id, nombre, email, 'empleado' as tipo
      FROM empleados 
      WHERE cookie = ?
    `;
    
    db.query(queryEmpleados, [empleadoToken], (err, resultsEmpleados) => {
      if (err) {
        console.error("Error al verificar autenticación en empleados:", err);
      } else if (resultsEmpleados.length > 0) {
        usuariosAutenticados.empleado = {
          id: resultsEmpleados[0].id,
          nombre: resultsEmpleados[0].nombre,
          email: resultsEmpleados[0].email,
          tipo: resultsEmpleados[0].tipo
        };
      }
      verificarCompletado();
    });
  }

  // Verificar paciente si hay token
  if (pacienteToken) {
    const queryPacientes = `
        SELECT id, nombre, email, 'paciente' as tipo
        FROM pacientes 
        WHERE cookie = ?
    `;
    
    db.query(queryPacientes, [pacienteToken], (err, resultsPacientes) => {
      if (err) {
        console.error("Error al verificar autenticación en pacientes:", err);
      } else if (resultsPacientes.length > 0) {
        usuariosAutenticados.paciente = {
          id: resultsPacientes[0].id,
          nombre: resultsPacientes[0].nombre,
          email: resultsPacientes[0].email,
          tipo: resultsPacientes[0].tipo
        };
      }
      verificarCompletado();
    });
  }
});

// MODIFICACIÓN: Logout con tu estilo de callbacks anidados
router.post("/logout", (req, res) => {
  const adminToken = req.cookies?.carolDental_admin;
  const pacienteToken = req.cookies?.carolDental_paciente;
  const empleadoToken = req.cookies?.carolDental_empleado;

  // Limpiar todas las cookies
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
    path: "/",
    maxAge: 0,
    domain: process.env.NODE_ENV === "production" ? ".onrender.com" : "localhost",
  };

  res.cookie("carolDental_admin", "", cookieOptions);
  res.cookie("carolDental_paciente", "", cookieOptions);
  res.cookie("carolDental_empleado", "", cookieOptions);

  // Queries separados
  const queryPacientes = `UPDATE pacientes SET cookie = NULL WHERE cookie = ?`;
  const queryAdministradores = `UPDATE administradores SET cookie = NULL WHERE cookie = ?`;
  const queryEmpleados = `UPDATE empleados SET cookie = NULL WHERE cookie = ?`;

  let resultadosAfectados = 0;

  // Primero intenta en pacientes si hay token
  if (pacienteToken) {
    db.query(queryPacientes, [pacienteToken], (err, resultPacientes) => {
      if (err) {
        console.error("Error al limpiar token en pacientes:", err);
      } else {
        resultadosAfectados += resultPacientes.affectedRows;
      }

      // Continuar con empleados
      limpiarEmpleados();
    });
  } else {
    // Si no hay token de paciente, continuar con empleados
    limpiarEmpleados();
  }

  function limpiarEmpleados() {
    if (empleadoToken) {
      db.query(queryEmpleados, [empleadoToken], (err, resultEmpleados) => {
        if (err) {
          console.error("Error al limpiar token en empleados:", err);
        } else {
          resultadosAfectados += resultEmpleados.affectedRows;
        }

        // Continuar con administradores
        limpiarAdministradores();
      });
    } else {
      // Si no hay token de empleado, continuar con administradores
      limpiarAdministradores();
    }
  }

  function limpiarAdministradores() {
    if (adminToken) {
      db.query(queryAdministradores, [adminToken], (err, resultAdmin) => {
        if (err) {
          console.error("Error al limpiar token en administradores:", err);
          return res.status(500).json({
            message: "Error al cerrar sesión."
          });
        }

        resultadosAfectados += resultAdmin.affectedRows;

        // Finalizar logout
        finalizarLogout();
      });
    } else {
      // Si no hay token de admin, finalizar
      finalizarLogout();
    }
  }

  function finalizarLogout() {
    if (resultadosAfectados === 0) {
      console.log("No se encontró el token en la base de datos");
      // Aún consideramos el logout exitoso ya que las cookies fueron eliminadas
      return res.status(200).json({
        message: "Sesión cerrada exitosamente."
      });
    }

    console.log("Sesión cerrada exitosamente en la base de datos");
    return res.status(200).json({
      message: "Sesión cerrada exitosamente."
    });
  }
});

module.exports = router;