'use client'
import { useState } from 'react';
import air from './index.module.css';
import { Svg_ArowRight, Svg_Eye, Svg_unEye } from '@/components/(icon)/svg';

const isValidEmail = (email) => { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); };

const InputField = ({ label, type, value, setValue }) => {
  const [focused, setFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const handleFocus = () => setFocused(true)
  const handleBlur = (e) => {
    if (e.target.value === '') setFocused(false)
  };
  const inputType = type === 'password' ? showPassword ? 'text' : 'password' : type;
  return (
    <div
      style={{
        position: 'relative',
        border: focused ? '2px solid #626262' : '2px solid var(--background)',
        backgroundColor: focused ? 'white' : '#f5f5f5',
        borderRadius: '3px',
        marginBottom: '16px',
      }}
    >
      <input
        type={inputType}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        style={{
          width: 'calc(100%)',
          padding: '16px',
          paddingTop: focused || value !== '' ? 22 : 16,
          paddingBottom: focused || value !== '' ? 10 : 16,
          border: 'none',
          outline: 'none',
          fontSize: '16px',
          color: '#333',
          borderRadius: 5,
          background: 'var(--bg-secondary)',
        }}
      />
      <label
        htmlFor={label}
        style={{
          position: 'absolute',
          top: '16px',
          left: '12px',
          transform: `translateY(${focused || value !== '' ? '-14px' : '0'
            }) scale(${focused || value !== '' ? '0.75' : '1'})`,
          transition: 'all 0.3s ease',
          color: focused || value !== '' ? '#626262' : '#999',
          pointerEvents: 'none',
        }}
      >
        {label}
      </label>
      {type === 'password' && (
        <div
          onClick={() => setShowPassword(!showPassword)}
          style={{
            position: 'absolute',
            top: '50%',
            right: '12px',
            transform: 'translateY(-50%)',
            cursor: 'pointer',
            color: '#626262',
          }}
          className='flex_center'
        >
          {showPassword ? <Svg_Eye w={18} h={18} c={'gray'} /> : <Svg_unEye w={18} h={18} c={'gray'} />}
        </div>
      )}
    </div>
  );
};

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setloading] = useState(false)
  const emailIsValid = isValidEmail(username);
  const passwordIsNotEmpty = password.trim() !== '';
  const isFormValid = emailIsValid && passwordIsNotEmpty;
  const handleSubmit = async () => {
    setloading(true)
    try {
      const trimmedUsername = username.trim();
      const trimmedPassword = password.trim();
      const data = { email: trimmedUsername, password: trimmedPassword, re: rememberMe };
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      console.log(result);
      window.location.reload()
    } catch (err) {
      console.error('Lỗi:', err);
    }
    setloading(false)
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (isFormValid) {
      handleSubmit();
    }
  };

  return (
    <>
      {loading ? <p className='text_2' style={{ fontSize: '30px', fontWeight: 'bold' }}>Đang đăng nhập</p> : <p className='text_2' style={{ fontSize: '30px', fontWeight: 'bold' }}>Đăng nhập LHU</p>}
      <div
        style={{
          backgroundColor: 'white',
          padding: '32px 32px 0 32px',
          borderRadius: '8px',
          width: '100%',
          fontsize: '200px',
          fontweight: 'bold',
        }}
      >
        {loading ?
          <div style={{ width: '100%', aspectRatio: 1, height: 'auto' }} className='flex_center'>
            {/* <CircularProgress color="inherit" /> */}
          </div> :
          <form onSubmit={handleFormSubmit}>
            <InputField label="Email" type="text" value={username} setValue={setUsername} />
            <InputField label="Mật khẩu" type="password" value={password} setValue={setPassword} />

            <div className="flex_center" style={{ justifyContent: 'start', gap: 8 }}>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  className={air['custom-checkbox']}
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                <p className="text_5_400">Ghi nhớ tôi</p>
              </label>
            </div>

            <div className="flex_center" style={{ margin: '40px 0' }}>
              <button
                type="submit"
                disabled={!isFormValid}
                style={{
                  height: 60,
                  width: 60,
                  borderRadius: 16,
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                className={isFormValid ? air.submit : air.unsubmit}
              >
                <Svg_ArowRight w={28} h={28} c={'white'} />
              </button>
            </div>
          </form>
        }
      </div>
    </>
  );
};

export default LoginPage;