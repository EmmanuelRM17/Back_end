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

def safe_float(value, default=0.0):
    if value is None:
        return default
    try:
        return float(value) if isinstance(value, (int, float)) else float(str(value).strip())
    except (ValueError, TypeError):
        return default

def safe_int(value, default=0):
    if value is None:
        return default
    try:
        return int(value) if isinstance(value, (int, float)) else int(float(str(value).strip()))
    except (ValueError, TypeError):
        return default

def calculate_age(birth_date):
    if not birth_date:
        return 30
    try:
        today = datetime.now()
        birth = datetime.fromisoformat(birth_date.replace('Z', ''))
        return int((today - birth).days / 365.25)
    except:
        return 30

def calculate_lead_time(fecha_solicitud, fecha_consulta):
    if not fecha_solicitud or not fecha_consulta:
        return 1
    try:
        sol = datetime.fromisoformat(fecha_solicitud.replace('Z', ''))
        cons = datetime.fromisoformat(fecha_consulta.replace('Z', ''))
        return max(1, (cons - sol).days)
    except:
        return 1

def encode_genero(genero_str):
    # Codificación igual que en entrenamiento (LabelEncoder)
    genero_map = {'Femenino': 0, 'Masculino': 2}  # Basado en tu entrenamiento
    return genero_map.get(str(genero_str).strip(), 1)

def encode_categoria(categoria_str):
    # Mapeo basado en tu query original
    categoria_map = {
        'General': 3, 'Periodoncia': 6, 'Restauración': 9,
        'Protesis': 4, 'Prótesis': 4, 'Especialidad': 1
    }
    return categoria_map.get(str(categoria_str).strip(), 3)

def extract_features(cita_data):
    fecha_consulta_str = cita_data.get('fecha_consulta', '')
    try:
        fecha_consulta = datetime.fromisoformat(fecha_consulta_str.replace('Z', ''))
    except:
        fecha_consulta = datetime.now()
    
    # EXACTAMENTE las 16 features del entrenamiento en el mismo orden
    features = [
        calculate_age(cita_data.get('paciente_fecha_nacimiento')),  # edad
        encode_genero(cita_data.get('paciente_genero')),  # genero
        1 if cita_data.get('paciente_alergias') else 0,  # alergias_flag
        calculate_lead_time(cita_data.get('fecha_solicitud'), cita_data.get('fecha_consulta')),  # lead_time_days
        fecha_consulta.weekday() + 1,  # dow
        fecha_consulta.hour,  # hour
        1 if fecha_consulta.weekday() >= 5 else 0,  # is_weekend
        encode_categoria(cita_data.get('categoria_servicio', 'General')),  # categoria_servicio
        safe_float(cita_data.get('precio_servicio', 600)),  # precio_servicio
        safe_float(cita_data.get('duracion', 30)),  # duration_min
        1 if str(cita_data.get('estado_pago', '')).strip() == 'Pagado' else 0,  # paid_flag
        safe_int(cita_data.get('tratamiento_pendiente', 0)),  # tratamiento_pendiente
        safe_float(cita_data.get('total_citas_historicas', 1)),  # total_citas
        safe_float(cita_data.get('total_no_shows_historicas', 0)),  # total_no_shows
        safe_float(cita_data.get('pct_no_show_historico', 0.0)),  # pct_no_show_historico
        safe_float(cita_data.get('dias_desde_ultima_cita', 0))  # dias_desde_ultima_cita
    ]
    return features

def predict_no_show(cita_data):
    if not model:
        return {'error': 'Modelo no disponible'}
    
    try:
        features = extract_features(cita_data)
        
        # Nombres exactos del entrenamiento
        feature_names = [
            'edad', 'genero', 'alergias_flag', 'lead_time_days', 'dow', 'hour', 
            'is_weekend', 'categoria_servicio', 'precio_servicio', 'duration_min',
            'paid_flag', 'tratamiento_pendiente', 'total_citas', 'total_no_shows', 
            'pct_no_show_historico', 'dias_desde_ultima_cita'
        ]
        
        X = pd.DataFrame([features], columns=feature_names)
        prediction = int(model.predict(X)[0])
        
        return {
            'success': True,
            'prediction': {
                'will_no_show': prediction
            }
        }
    except Exception as e:
        return {'error': f'Error en predicción: {str(e)}'}

if __name__ == "__main__":
    try:
        input_data = json.loads(sys.stdin.read())
        result = predict_no_show(input_data)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'error': str(e)}))