import ZaloAccount from "@/models/zalo.model";
import Setting from "@/models/setting.model";
import connectDB from "@/config/connectDB";
import { NextResponse } from "next/server";

export async function GET() {
    try {
        await connectDB();
        
        // Lấy ngày hiện tại
        const currentDate = new Date();
        const currentDateString = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD format
        
        // Lấy ngày của lần reset cuối cùng từ Setting
        const lastResetSetting = await Setting.findOne({ key: "zalo_last_daily_reset" });
        const lastResetDate = lastResetSetting ? lastResetSetting.value : null;
        
        // Kiểm tra nếu là ngày mới hoặc chưa có bản ghi reset trước đó
        const isNewDay = !lastResetDate || lastResetDate !== currentDateString;
        
        // Luôn reset giới hạn theo giờ
        const updateObj = { 
            "rateLimit.hourly": 30 
        };
        
        // Nếu là ngày mới, reset cả giới hạn theo ngày
        if (isNewDay) {
            updateObj["rateLimit.daily"] = 200;
            
            // Cập nhật hoặc tạo bản ghi ngày reset
            await Setting.updateOne(
                { key: "zalo_last_daily_reset" },
                { $set: { value: currentDateString } },
                { upsert: true }
            );
            
            console.log(`[Zalo Reset] ${currentDate.toISOString()} - Reset cả giới hạn giờ và ngày`);
        } else {
            console.log(`[Zalo Reset] ${currentDate.toISOString()} - Chỉ reset giới hạn giờ`);
        }
        
        // Áp dụng cập nhật cho tất cả tài khoản Zalo
        const result = await ZaloAccount.updateMany({}, updateObj);
        
        return NextResponse.json({
            success: true,
            message: `Đã reset giới hạn. ${isNewDay ? 'Cập nhật cả giới hạn theo ngày.' : 'Chỉ cập nhật giới hạn theo giờ.'}`,
            resetHourly: true,
            resetDaily: isNewDay,
            accounts: result.modifiedCount
        });
    } catch (error) {
        console.error("[Zalo Reset Error]", error);
        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}