const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const app = express();

// Middleware esencial para cookies
app.use(cookieParser());

// Configuración CORS esencial para cookies
app.use(cors({
  origin: [
    "http://localhost:3000",
    "https://back-end-4803.onrender.com",
    "https://odontologiacarol.com"
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Set-Cookie"] 
}));

// Configuración básica de seguridad con Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://www.google.com", "https://www.gstatic.com"],
      frameSrc: ["'self'", "https://www.google.com", "https://www.recaptcha.net"],
      imgSrc: ["'self'", "https://www.google.com", "https://www.gstatic.com"],
      connectSrc: [
        "'self'",
        "http://localhost:3000",
        "https://back-end-4803.onrender.com",
        "https://odontologiacarol.com/"
      ]
    }
  }
}));

// Middlewares básicos
app.use(bodyParser.json());
app.use(express.json());


// Tus rutas existentes
const userRoutes = require("./routes/userRoutes");
const Registrer = require("./routes/registrer");

const politicasRoutes = require("./routes/admin/inf/inf_politicasRoutes");
const deslindeRoutes = require("./routes/admin/inf/inf_deslindelegal");
const terminosRoutes = require("./routes/admin/inf/inf_terminosYcondicion");
const perfil_empresa = require("./routes/admin/inf/inf_perfilEmpresa");
const redes = require("./routes/admin/inf/inf_redessociales");
const servicios=  require("./routes/servicios"); 
const reportes = require("./routes/admin/inf/inf_reportes");
const preguntas = require("./routes/admin/preguntas");
const contactanos = require("./routes/admin/contact");
const expediente = require("./routes/empleado/expedientClinic");

//pacientes
const p_perfil = require("./routes/pacientes/perfil")
// Asignar rutas
app.use("/api", Registrer);
app.use("/api/users", userRoutes);

//administrador
app.use("/api/politicas", politicasRoutes);
app.use("/api/deslinde", deslindeRoutes);
app.use("/api/termiCondicion", terminosRoutes);
app.use("/api/perfilEmpresa", perfil_empresa);
app.use("/api/redesSociales", redes);
app.use("/api/reportes", reportes);
app.use("/api/servicios", servicios)
app.use("/api/preguntas", preguntas);
app.use("/api/contacto",contactanos)


//empleadooos
app.use("/api/expediente",expediente);

//pacientes
app.use("/api/profile", p_perfil);

app.listen(3001, () => {
  console.log("Servidor corriendo en puerto 3001");
});
