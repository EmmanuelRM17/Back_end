# Archivo: models/ml_predictions.py

import joblib
import json
import sys
import numpy as np
from datetime import datetime
import os

# Cargar el modelo al importar
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'modelo_noshow_predictor.pkl')

try:
    model = joblib.load(MODEL_PATH)
    print("Modelo cargado exitosamente", file=sys.stderr)
except Exception as e:
    print(f"Error cargando modelo: {e}", file=sys.stderr)
    model = None

def calculate_age(birth_date):
    """Calcular edad a partir de fecha de nacimiento"""
    if not birth_date:
        return 30
    try:
        today = datetime.now()
        birth = datetime.fromisoformat(birth_date.replace('Z', ''))
        return int((today - birth).days / 365.25)
    except:
        return 30

def calculate_lead_time(fecha_solicitud, fecha_consulta):
    """Calcular días entre solicitud y consulta"""
    if not fecha_solicitud or not fecha_consulta:
        return 1
    try:
        sol = datetime.fromisoformat(fecha_solicitud.replace('Z', ''))
        cons = datetime.fromisoformat(fecha_consulta.replace('Z', ''))
        return max(1, (cons - sol).days)
    except:
        return 1

def get_category_code(category):
    """Mapear categorías a códigos numéricos"""
    categories = {'General': 0, 'Especialidad': 1, 'Urgencia': 2}
    return categories.get(category, 0)

def extract_features(cita_data):
    """Extraer features del modelo a partir de datos de cita"""
    
    fecha_consulta_str = cita_data.get('fecha_consulta', '')
    try:
        fecha_consulta = datetime.fromisoformat(fecha_consulta_str.replace('Z', ''))
    except:
        fecha_consulta = datetime.now()
    
    edad = calculate_age(cita_data.get('paciente_fecha_nacimiento'))
    lead_time_days = calculate_lead_time(
        cita_data.get('fecha_solicitud'), 
        cita_data.get('fecha_consulta')
    )
    
    features = {
        'edad': edad,
        'genero': 1 if cita_data.get('paciente_genero') == 'Masculino' else 0,
        'alergias_flag': 1 if cita_data.get('paciente_alergias') else 0,
        'registro_completo': 1 if cita_data.get('paciente_registro_completo', True) else 0,
        'verificado': 1 if cita_data.get('paciente_verificado', True) else 0,
        'lead_time_days': lead_time_days,
        'dow': fecha_consulta.weekday() + 1,  # 1=Lunes, 7=Domingo
        'hour': fecha_consulta.hour,
        'is_weekend': 1 if fecha_consulta.weekday() >= 5 else 0,
        'categoria_servicio': get_category_code(cita_data.get('categoria_servicio', 'General')),
        'precio_servicio': float(cita_data.get('precio_servicio', 0)),
        'duration_min': int(cita_data.get('duracion', 30)),
        'paid_flag': 1 if cita_data.get('estado_pago') == 'Pagado' else 0,
        'tratamiento_pendiente': 1 if cita_data.get('tratamiento_pendiente') else 0,
        'total_citas': cita_data.get('total_citas_historicas', 1),
        'total_no_shows': cita_data.get('total_no_shows_historicas', 0),
        'pct_no_show_historico': cita_data.get('pct_no_show_historico', 0.0),
        'dias_desde_ultima_cita': cita_data.get('dias_desde_ultima_cita', 0)
    }
    
    return features

def get_risk_factors(features, probability):
    """Identificar principales factores de riesgo"""
    factors = []
    
    if features['pct_no_show_historico'] > 0.4:
        factors.append({
            'factor': 'Historial alto de inasistencias',
            'impact': 'Alto',
            'value': f"{features['pct_no_show_historico']*100:.0f}%"
        })
    elif features['pct_no_show_historico'] > 0.2:
        factors.append({
            'factor': 'Historial moderado de inasistencias', 
            'impact': 'Medio',
            'value': f"{features['pct_no_show_historico']*100:.0f}%"
        })
    
    if features['total_no_shows'] > 2:
        factors.append({
            'factor': 'Múltiples inasistencias previas',
            'impact': 'Alto', 
            'value': f"{features['total_no_shows']} faltas"
        })
    
    if features['edad'] < 25:
        factors.append({
            'factor': 'Paciente joven',
            'impact': 'Medio',
            'value': f"{features['edad']} años"
        })
    elif features['edad'] > 65:
        factors.append({
            'factor': 'Paciente adulto mayor',
            'impact': 'Medio', 
            'value': f"{features['edad']} años"
        })
    
    if features['hour'] < 9:
        factors.append({
            'factor': 'Cita muy temprano',
            'impact': 'Medio',
            'value': f"{features['hour']}:00"
        })
    elif features['hour'] > 17:
        factors.append({
            'factor': 'Cita muy tarde',
            'impact': 'Medio',
            'value': f"{features['hour']}:00"
        })
    
    return factors[:4]

def predict_no_show(cita_data):
    """Realizar predicción de no-show"""
    
    if not model:
        return {
            'error': 'Modelo no disponible'
        }
    
    try:
        # Extraer features
        features = extract_features(cita_data)
        
        # Orden correcto de features según el modelo
        feature_order = [
            'edad', 'genero', 'alergias_flag', 'registro_completo', 'verificado',
            'lead_time_days', 'dow', 'hour', 'is_weekend', 'categoria_servicio',
            'precio_servicio', 'duration_min', 'paid_flag', 'tratamiento_pendiente',
            'total_citas', 'total_no_shows', 'pct_no_show_historico', 'dias_desde_ultima_cita'
        ]
        
        # Convertir a array
        X = np.array([features[f] for f in feature_order]).reshape(1, -1)
        
        # Realizar predicción
        probability = float(model.predict_proba(X)[0, 1])
        prediction = bool(probability > 0.5)
        
        # Determinar nivel de riesgo
        if probability < 0.3:
            risk_level = 'bajo'
        elif probability < 0.7:
            risk_level = 'medio'
        else:
            risk_level = 'alto'
        
        # Obtener factores de riesgo
        risk_factors = get_risk_factors(features, probability)
        
        return {
            'success': True,
            'prediction': {
                'will_no_show': prediction,
                'probability': probability,
                'risk_level': risk_level,
                'risk_factors': risk_factors
            }
        }
        
    except Exception as e:
        return {
            'error': f'Error en predicción: {str(e)}'
        }

if __name__ == "__main__":
    # Leer datos JSON desde stdin
    try:
        input_data = json.loads(sys.stdin.read())
        result = predict_no_show(input_data)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'error': str(e)}))