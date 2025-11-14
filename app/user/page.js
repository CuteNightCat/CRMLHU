import Main from "./ui/main";
import { user_data } from "@/data/actions/get";
import checkAuthToken from "@/utils/checktoken";

function isExactlyManager(role) {
    return Array.isArray(role) && role.length === 1 && role[0] === "Manager";
}

function hideGroupForManagers(users) {
    // Luôn ẩn group đối với các user có role === ['Manager'] (cho tất cả người xem)
    return users.map((u) => {
        if (isExactlyManager(u.role)) {
            const { group, ...rest } = u;
            return rest;
        }
        return u;
    });
}

export default async function TeacherPage() {
    const session = await checkAuthToken();
    if (!session?.id) throw new Error("Unauthorized");

    // Gọi song song cho nhanh
    const [allUsers, currentUserArr] = await Promise.all([
        user_data({}),
        user_data({ _id: session.id }),
    ]);

    const currentUser = Array.isArray(currentUserArr) ? currentUserArr[0] : currentUserArr;
    const roles = Array.isArray(currentUser?.role) ? currentUser.role : [];

    const isManagerViewer = roles.includes("Manager");
    const isAdminSaleViewer = roles.includes("Admin Sale");

    // Bắt đầu từ toàn bộ users
    let visibleUsers = Array.isArray(allUsers) ? [...allUsers] : [];

    // 1) Manager & Admin Sale: không thấy user có role chứa "Admin"
    if (isManagerViewer || isAdminSaleViewer) {
        visibleUsers = visibleUsers.filter((u) => !u.role?.includes("Admin"));
    }

    // 2) Admin Sale: chỉ thấy người cùng group
    if (isAdminSaleViewer) {
        const myGroup = currentUser?.group ?? null;
        visibleUsers = visibleUsers.filter((u) => (myGroup ? u.group === myGroup : !u.group));
    }

    // 3) Ẩn group của các Manager đối với MỌI quyền
    visibleUsers = hideGroupForManagers(visibleUsers);

    // Lưu ý:
    // - Người xem là Manager: giờ chỉ mất group của các user-Manager; các user khác vẫn giữ group.
    // - Người xem là Admin Sale: vẫn bị giới hạn cùng group + ẩn group của các Manager.
    // - Người xem khác (Admin, Sale…): thấy tất cả, nhưng group của các Manager vẫn bị ẩn.

    return <Main initialTeachers={visibleUsers} />;
}
