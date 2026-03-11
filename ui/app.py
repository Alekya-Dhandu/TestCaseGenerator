import streamlit as st
from src.data_loader import load_platform_data, load_prd
from src.ai_generator import generate_test_cases
from src.formatter import format_to_excel
import json  # For API upload

st.title("AI Test Case Bot 🧪")

# Sidebar for uploads
platform = load_platform_data()
st.sidebar.json(platform)  # Show your data

uploaded_prd = st.file_uploader("Upload PRD (PDF)")
uploaded_api = st.file_uploader("Upload API Design (JSON)")

if st.button("Generate Test Cases"):
    if uploaded_prd and uploaded_api:
        prd_text = load_prd(uploaded_prd)
        api_design = json.load(uploaded_api)
        
        with st.spinner("Generating with AI..."):
            test_cases = generate_test_cases(prd_text, api_design, platform)
            df = format_to_excel(test_cases)
            
        st.dataframe(df)  # Preview
        st.download_button("Download XLSX", data=open('data/outputs/generated_tests.xlsx', 'rb').read(), file_name="test_cases.xlsx")
    else:
        st.error("Upload both files!")