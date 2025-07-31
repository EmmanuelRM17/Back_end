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
    """Calcula edad desde fecha de nacimiento"""
    if not birth_date:
        return 30
    try:
        today = datetime.now()
        birth = datetime.fromisoformat(birth_date.replace('Z', ''))
        return int((today - birth).days / 365.25)
    except:
        return 30

def calculate_lead_time(fecha_solicitud, fecha_consulta):
    """Calcula días entre solicitud y consulta"""
    if not fecha_solicitud or not fecha_consulta:
        return 1
    try:
        sol = datetime.fromisoformat(fecha_solicitud.replace('Z', ''))
        cons = datetime.fromisoformat(fecha_consulta.replace('Z', ''))
        return max(1, (cons - sol).days)
    except:
        return 1

def encode_genero(genero_str):
    """Codifica género usando el mismo mapeo del entrenamiento"""
    # LabelEncoder en orden alfabético: Femenino=0, Masculino=1
    genero_map = {
        'Femenino': 0,
        'femenino': 0,
        'F': 0,
        'f': 0,
        'Masculino': 1,
        'masculino': 1,
        'M': 1,
        'm': 1
    }
    return genero_map.get(str(genero_str).strip(), 0)  # Default Femenino

def encode_categoria(categoria_str):
    """Codifica categoría de servicio usando mapeo del entrenamiento"""
    # Basado en el orden alfabético que usaría LabelEncoder
    categoria_map = {
        'Cirugia': 0,
        'Cirugía': 0,
        'cirugia': 0,
        'cirugía': 0,
        'Endodoncia': 1,
        'endodoncia': 1,
        'Especialidad': 2,
        'especialidad': 2,
        'General': 3,
        'general': 3,
        'Higiene': 4,  # ✅ AGREGADO
        'higiene': 4,  # ✅ AGREGADO
        'Implantologia': 5,
        'implantologia': 5,
        'Ortodoncia': 6,
        'ortodoncia': 6,
        'Periodoncia': 7,
        'periodoncia': 7,
        'Preventivo': 8,  # ✅ AGREGADO
        'preventivo': 8,  # ✅ AGREGADO
        'Protesis': 9,
        'Prótesis': 9,
        'protesis': 9,
        'prótesis': 9,
        'Restauracion': 10,
        'Restauración': 10,
        'restauracion': 10,
        'restauración': 10
    }
    return categoria_map.get(str(categoria_str).strip(), 3)  # Default General

def get_mysql_dayofweek(fecha_consulta):
    """Convierte weekday de Python a DAYOFWEEK de MySQL"""
    # Python: lunes=0, martes=1, ..., domingo=6
    # MySQL: domingo=1, lunes=2, ..., sábado=7
    python_weekday = fecha_consulta.weekday()
    mysql_dayofweek = (python_weekday + 2) % 7
    if mysql_dayofweek == 0:
        mysql_dayofweek = 7
    return mysql_dayofweek

def is_weekend_mysql(fecha_consulta):
    """Determina si es fin de semana usando lógica MySQL"""
    mysql_dow = get_mysql_dayofweek(fecha_consulta)
    return 1 if mysql_dow in [1, 7] else 0  # domingo=1, sábado=7

def extract_features(cita_data):
    """Extrae las 16 features exactamente como el modelo espera"""
    fecha_consulta_str = cita_data.get('fecha_consulta', '')
    try:
        fecha_consulta = datetime.fromisoformat(fecha_consulta_str.replace('Z', ''))
    except:
        fecha_consulta = datetime.now()
    
    # Log información del paciente
    es_registrado = cita_data.get('paciente_id') is not None
    print(f"Procesando paciente {'registrado' if es_registrado else 'NO registrado'}", file=sys.stderr)
    
    # Las 16 features en el orden EXACTO del entrenamiento
    features = [
        calculate_age(cita_data.get('paciente_fecha_nacimiento')),  # edad
        encode_genero(cita_data.get('paciente_genero', 'Femenino')),  # genero
        1 if cita_data.get('paciente_alergias') else 0,  # alergias_flag
        calculate_lead_time(cita_data.get('fecha_solicitud'), cita_data.get('fecha_consulta')),  # lead_time_days
        get_mysql_dayofweek(fecha_consulta),  # dow (MySQL DAYOFWEEK)
        fecha_consulta.hour,  # hour
        is_weekend_mysql(fecha_consulta),  # is_weekend (MySQL logic)
        encode_categoria(cita_data.get('categoria_servicio', 'General')),  # categoria_servicio
        safe_float(cita_data.get('precio_servicio', 600)),  # precio_servicio
        safe_float(cita_data.get('duracion', 30)),  # duration_min
        1 if str(cita_data.get('estado_pago', '')).strip() == 'Pagado' else 0,  # paid_flag
        safe_int(cita_data.get('tratamiento_pendiente', 0)),  # tratamiento_pendiente
        safe_float(cita_data.get('total_citas_historicas', 0)),  # total_citas (puede ser 0 para no registrados)
        safe_float(cita_data.get('total_no_shows_historicas', 0)),  # total_no_shows
        safe_float(cita_data.get('pct_no_show_historico', 0.0)),  # pct_no_show_historico
        safe_float(cita_data.get('dias_desde_ultima_cita', 0))  # dias_desde_ultima_cita
    ]
    
    # Log features para debugging
    feature_names = [
        'edad', 'genero', 'alergias_flag', 'lead_time_days', 'dow', 'hour', 
        'is_weekend', 'categoria_servicio', 'precio_servicio', 'duration_min',
        'paid_flag', 'tratamiento_pendiente', 'total_citas', 'total_no_shows', 
        'pct_no_show_historico', 'dias_desde_ultima_cita'
    ]
    
    print(f"Features extraídas:", file=sys.stderr)
    for name, value in zip(feature_names, features):
        print(f"  {name}: {value}", file=sys.stderr)
    
    return features

def predict_no_show(cita_data):
    """Predice si un paciente faltará a su cita"""
    if not model:
        return {'error': 'Modelo no disponible'}
    
    try:
        features = extract_features(cita_data)
        
        # Nombres exactos del entrenamiento (mismo orden)
        feature_names = [
            'edad', 'genero', 'alergias_flag', 'lead_time_days', 'dow', 'hour', 
            'is_weekend', 'categoria_servicio', 'precio_servicio', 'duration_min',
            'paid_flag', 'tratamiento_pendiente', 'total_citas', 'total_no_shows', 
            'pct_no_show_historico', 'dias_desde_ultima_cita'
        ]
        
        # Crear DataFrame exactamente como en el entrenamiento
        X = pd.DataFrame([features], columns=feature_names)
        
        # Hacer predicción
        prediction = int(model.predict(X)[0])
        probability = float(model.predict_proba(X)[0, 1])  # Probabilidad de no-show
        
        return {
            'success': True,
            'prediction': {
                'will_no_show': prediction,  # 1 = No Show, 0 = Asistirá
                'probability': probability,
                'features_used': dict(zip(feature_names, features))
            }
        }
    except Exception as e:
        return {'error': f'Error en predicción: {str(e)}'}

def debug_features(cita_data):
    """Función auxiliar para debugging"""
    try:
        features = extract_features(cita_data)
        feature_names = ['edad', 'genero', 'alergias_flag', 'lead_time_days', 'dow', 'hour', 
                        'is_weekend', 'categoria_servicio', 'precio_servicio', 'duration_min',
                        'paid_flag', 'tratamiento_pendiente', 'total_citas', 'total_no_shows', 
                        'pct_no_show_historico', 'dias_desde_ultima_cita']
        
        return {
            'features': dict(zip(feature_names, features)),
            'raw_data': cita_data
        }
    except Exception as e:
        return {'error': str(e)}

if __name__ == "__main__":
    try:
        input_data = json.loads(sys.stdin.read())
        
        # Agregar modo debug si se especifica
        if input_data.get('debug', False):
            result = debug_features(input_data)
        else:
            result = predict_no_show(input_data)
            
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'error': str(e)}))