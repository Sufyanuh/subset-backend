import { loginAdmin } from "../controller/admin/auth.js";
import { GetCategories } from "../controller/admin/categories.js";
import {
  GetDiscover,
  GetDiscoverById,
  GetDiscoverToLogin,
} from "../controller/admin/discover.js";
import { extractData } from "../controller/admin/extractData.js";
import {
  forgotPassword,
  getUser,
  loginUser,
  loginWithGoogle,
  registerUser,
  resetPassword,
  verifyEmail,
} from "../controller/user/auth.js";
import {
  CreateBoard,
  getUsersBoardsByusername,
} from "../controller/user/boards.js";
import { filterDiscoveries } from "../controller/user/discover.js";
import { SlackAuthURL } from "../controller/user/slack.js";
import {
  deleteUser,
  editProfile,
  getUserByUserName,
  RemoveDiscoverFromUser,
  SaveDiscoverToUser,
  toggleEmailNotifications,
} from "../controller/user/user.js";
import { checkAuthToken } from "../middleware/checkToken.js";
import { User } from "../model/user.js";
import { categoriesRouter } from "./admin/categories.js";
import { channelRouter } from "./admin/channels.js";
import { discoverRouter } from "./admin/discover.js";
import adminMentorRoutes from "./admin/mentor.js";
import { subChannelRoutes } from "./admin/subChannels.js";
import { userRouter } from "./admin/user.js";
import { userBoardsRouter } from "./user/boards.js";
import booknowRoutes from "./user/booknow.js";
import { channelRoutes } from "./user/channel.js";
import chatRoutes from "./user/chat.js";
import { commentRoutes } from "./user/comment.js";
import mentorRoutes from "./user/mentor.js";
import notificationRoutes from "./user/notification.js";
import { paymentRoutes } from "./user/payment.js";
import { postRoutes } from "./user/post.js";

export function registerRoutes(app) {
  // Public endpoints

  app.get("/api/discover", GetDiscover);
  app.get("/api/checkUsersSubscription/:userId", checkUsersSubscription);
  app.get("/api/link-preview", getLinkPreview);
  app.use("/api/upload", S3routes);
  app.use("/api/subscribe", subscribeRoute);
  app.post("/api/contact-us", ContactUs);
  app.get("/api/discover", GetDiscover);
  app.get("/api/discoverLogin", GetDiscoverToLogin);
  app.get("/api/discover/:id", GetDiscoverById);
  app.get("/api/searchDiscover", filterDiscoveries);
  app.get("/api/categories", GetCategories);
  app.post("/api/user/google-login", loginWithGoogle);

  app.post("/api/user/login", loginUser);
  app.post("/api/user/signup", registerUser);
  app.post("/api/user/verifyEmail", verifyEmail);
  app.post("/api/user/forgot-password", forgotPassword);
  app.post("/api/user/reset-password", resetPassword);
  app.post("/api/user/edit-profile", checkAuthToken, editProfile);
  app.post(
    "/api/user/subscription-details",
    checkAuthToken,
    getSubscriptionDetails,
  );
  app.post(
    "/api/user/create-checkout-session",
    checkAuthToken,
    createCheckoutSession,
  );
  app.get("/api/user/verify-checkout", verifyCheckoutSession);
  app.post("/api/admin/login", loginAdmin);
  app.get("/api/getAllusers", async (req, res) => {
    const { search } = req.query;

    try {
      const query = search
        ? {
            $or: [
              { username: { $regex: search, $options: "i" } },
              { fullName: { $regex: search, $options: "i" } },
            ],
          }
        : {};

      const users = await User.find(query);
      res
        .status(200)
        .json({ message: "Users fetched successfully", data: users });
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users." });
    }
  });

  // Admin routes
  app.use("/api/admin/user", checkAuthToken, userRouter);
  app.use("/api/admin/discover", checkAuthToken, discoverRouter);
  app.use("/api/admin/category", checkAuthToken, categoriesRouter);
  app.use("/api/admin/channel", checkAuthToken, channelRouter);
  app.use("/api/admin/subchannel", checkAuthToken, subChannelRoutes);
  app.use("/api/admin/mentors", adminMentorRoutes);
  app.post("/api/admin/rekognition", analyzeS3Images);
  // User routes
  app.use("/api/user/board", userBoardsRouter);
  app.use("/api/user/savedBoards", checkAuthToken, savedBoardsRoutes);
  app.delete("/api/user/delete", checkAuthToken, deleteUser);
  app.post("/api/submit", sumbitworkMail);
  app.post("/api/request-credits", requestCreditsMail);
  app.post("/api/user/savediscover", checkAuthToken, SaveDiscoverToUser);
  app.delete(
    "/api/user/removediscover/:discoverId",
    checkAuthToken,
    RemoveDiscoverFromUser,
  );
  app.get("/api/user/getboards/:username", getUsersBoardsByusername);
  app.post("/api/user/detail", getUser);
  app.get("/api/user/detail/:username", getUserByUserName);

  app.get("/api/auth/slack", SlackAuthURL);
  app.use("/api/user/channels", channelRoutes);
  app.post("/api/user/createboard", checkAuthToken, CreateBoard);
  app.post("/api/admin/extractData", extractData);

  app.get("/api/user/post/postById/:postId", getPostById);
  app.use("/api/user/post", checkAuthToken, postRoutes);

  app.use("/api/post/comment", checkAuthToken, commentRoutes);
  app.get(
    "/api/user/toggleEmailNotifications",
    checkAuthToken,
    toggleEmailNotifications,
  );

  app.use("/api/mentors", mentorRoutes);
  app.use("/api/user/booknow", booknowRoutes);
  app.use("/api/user/chat", chatRoutes);
  app.use("/api/user/notifications", notificationRoutes);

  // upload Routes
  app.use("/api", FileUploadroutes);

  app.use("/api/user/payment", paymentRoutes);
}

// These imports need to be after function due to circular usage in some setups
import { analyzeS3Images } from "../controller/admin/rekognitionController.js";
import { checkUsersSubscription } from "../controller/admin/user.js";
import { ContactUs } from "../controller/user/contact.js";
import { getLinkPreview } from "../controller/user/linkPreview.js";
import {
  createCheckoutSession,
  verifyCheckoutSession,
} from "../controller/user/payment.js";
import { getPostById } from "../controller/user/post.js";
import { requestCreditsMail } from "../controller/user/requestCredits.js";
import { sumbitworkMail } from "../controller/user/submitform.js";
import { getSubscriptionDetails } from "../services/getUserSubscription.js";
import S3routes from "./s3Routes.js";
import FileUploadroutes from "./uploadRoutes.js";
import { savedBoardsRoutes } from "./user/savedboards.js";
import { subscribeRoute } from "./user/subscribe.js";

