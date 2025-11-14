'use client';

import Login_form from "@/components/(layout)/login";
import Image from "next/image";
import { Svg_Facebook, Svg_Website } from "@/components/(icon)/svg";
import Link from "next/link";


export default function Layout_Login() {
  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      <div style={{ width: 600, alignItems: 'center', maxHeight: '100%', justifyContent: 'space-between' }} className="flex_col scroll">
        <div style={{ width: '100%', alignItems: 'center' }} className="flex_col">
          <div style={{ margin: '30px 0', width: '80%' }}>
            <p style={{ fontWeight: 800, color: 'var(--text)', fontSize: 32, textAlign: 'center' }}>
              {/* <span style={{ color: 'var(--main_d)' }}>Admissions Management</span> LHU</p> */}
              <span style={{ color: 'var(--yellow)' }}>Admissions Management</span> <span style={{ color: 'var(--main_b)' }}> LHU</span></p>
            <h5 style={{ marginTop: '5px', textAlign: 'center',fontSize: '18px' }}>Quản lý tuyển sinh dễ dàng
          -Hiệu quả   
          -Tiện lợi - Dễ dàng.</h5>
          </div>
          <Login_form />
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        {/* <Image src='https://lh3.googleusercontent.com/d/1jEyhFxHD4PllLVPTDjIfF5AeT4x0OYqL' priority fill style={{ objectFit: "cover" }} alt="Full screen image" /> */}
        <Image src='https://sinhvientuonglai.lhu.edu.vn/ViewPage/LHUVNB4/SinhVienTuongLai/_Images/2025.03.26-Sinh-vien-tuong-lai.jpg' priority fill style={{ objectFit: "cover" }} alt="Full screen image" />
      </div>
    </div >
  )
}

