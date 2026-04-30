import { Router } from "express";
import {
  checkUsersSubscription,
  deleteUser,
  getAllUsers,
  refreshUserSubscription,
  toggleActiveStatus,
  toggleAdminStatus,
  toggleEmailNotifications,
  togglePaidStatus,
  updateUser,
} from "../../controller/admin/user.js";
export const userRouter = Router();
userRouter.get("/", getAllUsers);
userRouter.post("/updateStatus", togglePaidStatus);
userRouter.post("/toggleAdminStatus", toggleAdminStatus);
userRouter.post("/toggleActiveStatus", toggleActiveStatus);
userRouter.post("/toggleEmailNotifications/:userId", toggleEmailNotifications);

userRouter.post("/refresh-subscription", refreshUserSubscription);
userRouter.put("/update/:userId", updateUser);
userRouter.delete("/:userId", deleteUser);

userRouter.get("/checkUsersSubscription/:userId", checkUsersSubscription);
