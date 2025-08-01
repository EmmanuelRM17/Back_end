import joblib
import json
import sys
import numpy as np
import pandas as pd
from datetime import datetime
import os

MODEL_PATH = os.path.join(os.path.dirname(__file__), 'modelo_noshow_predictor.pkl')

try:
    model = joblib.load(MODEL_PATH)
except Exception as e:
    model = None
    print(f"Error cargando modelo: {e}", file=sys.stderr)

def safe_float(value, default=0.0):
    """Convierte valor a float de forma segura"""
    if value is None:
        return default
    try:
        return float(value) if isinstance(value, (int, float)) else float(str(value).strip())
    except (ValueError, TypeError):
        return default

def safe_int(value, default=0):
    """Convierte valor a int de forma segura"""
    if value is None:
        return default
    try:
        return int(value) if isinstance(value, (int, float)) else int(float(str(value).strip()))
    except (ValueError, TypeError):
        return default

def calculate_age(birth_date):
    """Calcula edad desde fecha de nacimiento - OPTIMISTA para no registrados"""
    if not birth_date:
        return 35  # ✅ CAMBIO: Edad más madura (menos riesgo)
    try:
        today = datetime.now()
        birth = datetime.fromisoformat(birth_date.replace('Z', ''))
        return int((today - birth).days / 365.25)
    except:
        return 35  # ✅ CAMBIO: Default optimista

def calculate_lead_time(fecha_solicitud, fecha_consulta):
    """Calcula días entre solicitud y consulta - OPTIMISTA"""
    if not fecha_solicitud or not fecha_consulta:
        return 3  # ✅ CAMBIO: Lead time moderado (no muy corto)
    try:
        sol = datetime.fromisoformat(fecha_solicitud.replace('Z', ''))
        cons = datetime.fromisoformat(fecha_consulta.replace('Z', ''))
        return max(1, (cons - sol).days)
    except:
        return 3  # ✅ CAMBIO: Default optimista

def encode_genero(genero_str):
    """Codifica género usando el mismo mapeo del entrenamiento"""
    genero_map = {
        'Femenino': 0, 'femenino': 0, 'F': 0, 'f': 0,
        'Masculino': 1, 'masculino': 1, 'M': 1, 'm': 1
    }
    return genero_map.get(str(genero_str).strip(), 0)  # Default Femenino

def encode_categoria(categoria_str):
    """Codifica categoría de servicio usando mapeo del entrenamiento"""
    categoria_map = {
        'Cirugia': 0, 'Cirugía': 0, 'cirugia': 0, 'cirugía': 0,
        'Endodoncia': 1, 'endodoncia': 1,
        'Especialidad': 2, 'especialidad': 2,
        'General': 3, 'general': 3,
        'Higiene': 4, 'higiene': 4,
        'Implantologia': 5, 'implantologia': 5,
        'Ortodoncia': 6, 'ortodoncia': 6,
        'Periodoncia': 7, 'periodoncia': 7,
        'Preventivo': 8, 'preventivo': 8,
        'Protesis': 9, 'Prótesis': 9, 'protesis': 9, 'prótesis': 9,
        'Restauracion': 10, 'Restauración': 10, 'restauracion': 10, 'restauración': 10
    }
    return categoria_map.get(str(categoria_str).strip(), 3)  # Default General

def get_mysql_dayofweek(fecha_consulta):
    """Convierte weekday de Python a DAYOFWEEK de MySQL"""
    python_weekday = fecha_consulta.weekday()
    mysql_dayofweek = (python_weekday + 2) % 7
    if mysql_dayofweek == 0:
        mysql_dayofweek = 7
    return mysql_dayofweek

def is_weekend_mysql(fecha_consulta):
    """Determina si es fin de semana usando lógica MySQL"""
    mysql_dow = get_mysql_dayofweek(fecha_consulta)
    return 1 if mysql_dow in [1, 7] else 0

def extract_features(cita_data):
    """Extrae las 16 features con valores OPTIMISTAS para balancear"""
    fecha_consulta_str = cita_data.get('fecha_consulta', '')
    try:
        fecha_consulta = datetime.fromisoformat(fecha_consulta_str.replace('Z', ''))
    except:
        fecha_consulta = datetime.now()
    
    es_registrado = cita_data.get('paciente_id') is not None
    print(f"Procesando paciente {'registrado' if es_registrado else 'NO registrado'}", file=sys.stderr)
    
    # ✅ AJUSTES PARA BALANCEAR LAS PREDICCIONES
    
    # Para pacientes NO registrados, dar valores más optimistas
    if not es_registrado:
        total_citas_default = 1      # Como si fuera paciente nuevo confiable
        total_no_shows_default = 0   # Sin historial negativo
        pct_no_show_default = 0.0    # Perfil limpio
        dias_ultima_default = 5      # Como si hubiera venido recientemente
    else:
        # Para registrados, usar datos reales
        total_citas_default = safe_float(cita_data.get('total_citas_historicas', 1))
        total_no_shows_default = safe_float(cita_data.get('total_no_shows_historicas', 0))
        pct_no_show_default = safe_float(cita_data.get('pct_no_show_historico', 0.0))
        dias_ultima_default = safe_float(cita_data.get('dias_desde_ultima_cita', 0))

    # Las 16 features en el orden EXACTO del entrenamiento
    features = [
        calculate_age(cita_data.get('paciente_fecha_nacimiento')),  # edad (más optimista)
        encode_genero(cita_data.get('paciente_genero', 'Femenino')),  # genero
        1 if cita_data.get('paciente_alergias') else 0,  # alergias_flag
        calculate_lead_time(cita_data.get('fecha_solicitud'), cita_data.get('fecha_consulta')),  # lead_time_days (más optimista)
        get_mysql_dayofweek(fecha_consulta),  # dow
        fecha_consulta.hour,  # hour
        is_weekend_mysql(fecha_consulta),  # is_weekend
        encode_categoria(cita_data.get('categoria_servicio', 'General')),  # categoria_servicio
        safe_float(cita_data.get('precio_servicio', 600)),  # precio_servicio
        safe_float(cita_data.get('duracion', 30)),  # duration_min
        1 if str(cita_data.get('estado_pago', '')).strip() == 'Pagado' else 0,  # paid_flag
        safe_int(cita_data.get('tratamiento_pendiente', 0)),  # tratamiento_pendiente
        total_citas_default,      # ✅ total_citas (optimista para no registrados)
        total_no_shows_default,   # ✅ total_no_shows (optimista para no registrados)
        pct_no_show_default,      # ✅ pct_no_show_historico (optimista para no registrados)
        dias_ultima_default       # ✅ dias_desde_ultima_cita (optimista para no registrados)
    ]
    
    feature_names = [
        'edad', 'genero', 'alergias_flag', 'lead_time_days', 'dow', 'hour', 
        'is_weekend', 'categoria_servicio', 'precio_servicio', 'duration_min',
        'paid_flag', 'tratamiento_pendiente', 'total_citas', 'total_no_shows', 
        'pct_no_show_historico', 'dias_desde_ultima_cita'
    ]
    
    print(f"Features extraídas {'(OPTIMIZADAS - no registrado)' if not es_registrado else '(registrado)'}:", file=sys.stderr)
    for name, value in zip(feature_names, features):
        print(f"  {name}: {value}", file=sys.stderr)
    
    return features

def calibrate_probability(raw_probability, es_registrado, lead_time, edad):
    """Calibra la probabilidad para balancear mejor las predicciones"""
    
    # ✅ CALIBRACIÓN PERSONALIZADA
    calibrated = raw_probability
    
    # Penalizar menos a pacientes no registrados (son nuevos)
    if not es_registrado:
        calibrated *= 0.7  # Reducir probabilidad de no-show en 30%
        print(f"Ajuste no-registrado: {raw_probability:.3f} -> {calibrated:.3f}", file=sys.stderr)
    
    # Bonificar lead times moderados (3-14 días)
    if 3 <= lead_time <= 14:
        calibrated *= 0.85  # Reducir riesgo para lead times óptimos
        print(f"Ajuste lead-time óptimo: {calibrated:.3f}", file=sys.stderr)
    
    # Bonificar edades maduras (25-55 años)
    if 25 <= edad <= 55:
        calibrated *= 0.9   # Adultos son más responsables
        print(f"Ajuste edad madura: {calibrated:.3f}", file=sys.stderr)
    
    # Asegurar que esté en rango válido
    calibrated = max(0.0, min(1.0, calibrated))
    
    print(f"Calibración final: {raw_probability:.3f} -> {calibrated:.3f}", file=sys.stderr)
    return calibrated

def predict_no_show(cita_data):
    """Predice si un paciente faltará a su cita con THRESHOLD AJUSTADO"""
    if not model:
        return {'error': 'Modelo no disponible'}
    
    try:
        features = extract_features(cita_data)
        
        feature_names = [
            'edad', 'genero', 'alergias_flag', 'lead_time_days', 'dow', 'hour', 
            'is_weekend', 'categoria_servicio', 'precio_servicio', 'duration_min',
            'paid_flag', 'tratamiento_pendiente', 'total_citas', 'total_no_shows', 
            'pct_no_show_historico', 'dias_desde_ultima_cita'
        ]
        
        X = pd.DataFrame([features], columns=feature_names)
        
        # Obtener probabilidad raw del modelo
        raw_probability = float(model.predict_proba(X)[0, 1])
        
        # ✅ CALIBRAR PROBABILIDAD para balancear predicciones
        es_registrado = cita_data.get('paciente_id') is not None
        lead_time = features[3]  # lead_time_days
        edad = features[0]       # edad
        
        calibrated_probability = calibrate_probability(raw_probability, es_registrado, lead_time, edad)
        
        # ✅ THRESHOLD AJUSTADO: Más conservador para predecir no-show
        threshold = 0.65  # En lugar de 0.5, usar 0.65
        
        prediction = 1 if calibrated_probability > threshold else 0
        
        print(f"=== DECISIÓN FINAL ===", file=sys.stderr)
        print(f"Probabilidad raw: {raw_probability:.3f}", file=sys.stderr)
        print(f"Probabilidad calibrada: {calibrated_probability:.3f}", file=sys.stderr)
        print(f"Threshold: {threshold}", file=sys.stderr)
        print(f"Predicción: {'NO asistirá' if prediction == 1 else 'SÍ asistirá'}", file=sys.stderr)
        
        return {
            'success': True,
            'prediction': {
                'will_no_show': prediction,
                'probability': calibrated_probability,  # Usar probabilidad calibrada
                'raw_probability': raw_probability,     # Mantener original para debug
                'threshold_used': threshold,
                'calibration_applied': True,
                'features_used': dict(zip(feature_names, features))
            }
        }
    except Exception as e:
        return {'error': f'Error en predicción: {str(e)}'}

def debug_features(cita_data):
    """Función auxiliar para debugging con info de calibración"""
    try:
        features = extract_features(cita_data)
        feature_names = ['edad', 'genero', 'alergias_flag', 'lead_time_days', 'dow', 'hour', 
                        'is_weekend', 'categoria_servicio', 'precio_servicio', 'duration_min',
                        'paid_flag', 'tratamiento_pendiente', 'total_citas', 'total_no_shows', 
                        'pct_no_show_historico', 'dias_desde_ultima_cita']
        
        return {
            'features': dict(zip(feature_names, features)),
            'raw_data': cita_data,
            'optimizations_applied': {
                'edad_default': 35,
                'lead_time_default': 3,
                'threshold': 0.65,
                'calibration_enabled': True
            }
        }
    except Exception as e:
        return {'error': str(e)}

if __name__ == "__main__":
    try:
        input_data = json.loads(sys.stdin.read())
        
        if input_data.get('debug', False):
            result = debug_features(input_data)
        else:
            result = predict_no_show(input_data)
            
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'error': str(e)}))