import { parseMentionsToHTML } from "./parseMentionsToHTML.js";

export const generateEmailTemplate = (user, groupedNotifications, date) => {
  const totalNotifications = Object.values(groupedNotifications).flat().length;
  const username = user.fullName || user.username || user.name || "User";

  // Helper functions
  const truncateText = (text, maxLength = 120) => {
    if (!text) return "";
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "....";
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Generate notification items with table layout
  const generateNotificationItems = (notifications, type) => {
    if (!notifications || notifications.length === 0) return "";

    return notifications
      .map((notif, index) => {
        const actorName =
          notif.actor?.fullName ||
          notif.actor?.username ||
          notif.actor?.name ||
          "Someone";
        const content = notif.body || notif.title || "";
        const time = formatTime(notif.createdAt);

        let actionText = "";
        switch (type) {
          case "messages":
            actionText = "sent you a message:";
            break;
          case "replies":
            actionText = "replied to you:";
            break;
          case "likes":
            actionText = "liked your post:";
            break;
          case "mentions":
            actionText = "mentioned you:";
            break;
          default:
            actionText = "";
        }
        const newtext = truncateText(content);
        const isLastItem = index === notifications.length - 1;
        const unsubscribeLink = `https://api.thesubset.org/api/unsubscribeNotifications/${user._id}`;
        return `
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="${
          !isLastItem ? "border-bottom: 1px solid #c2c2c2;" : ""
        }">
          <tr>
            <td style="padding: 25px 0 25px 0;">

              <div style="font-weight: 590; font-size: 14px; padding-bottom: 20px">
                ${actorName}
                <span style="font-weight: 400; font-size: 14px">
                  ${actionText}
                </span>
               <!--- <span style="font-weight: 400; font-size: 12px; color: #666; margin-left: 10px">
                  ${time}
                </span>--->
              </div>
              <div style="font-weight: 400; font-style: italic; font-size: 14px; color: #333;">
                "${parseMentionsToHTML(newtext)}"
              </div>
            </td>
          </tr>
        </table>
      `;
      })
      .join("");
  };

  // Generate stats table
  const generateStatsTable = () => {
    let statsHTML = "";

    if (groupedNotifications.messages.length > 0) {
      statsHTML += `
        <td align="center" valign="middle" style="padding: 10px;">
          <div style="font-size: 28px; font-weight: 590;">${groupedNotifications.messages.length}</div>
          <div style="font-size: 12px; color: #666;">Messages</div>
        </td>
      `;
    }

    if (groupedNotifications.replies.length > 0) {
      statsHTML += `
        <td align="center" valign="middle" style="padding: 10px;">
          <div style="font-size: 28px; font-weight: 590;">${groupedNotifications.replies.length}</div>
          <div style="font-size: 12px; color: #666;">Replies</div>
        </td>
      `;
    }

    if (groupedNotifications.likes.length > 0) {
      statsHTML += `
        <td align="center" valign="middle" style="padding: 10px;">
          <div style="font-size: 28px; font-weight: 590;">${groupedNotifications.likes.length}</div>
          <div style="font-size: 12px; color: #666;">Likes</div>
        </td>
      `;
    }

    if (groupedNotifications.mentions.length > 0) {
      statsHTML += `
        <td align="center" valign="middle" style="padding: 10px;">
          <div style="font-size: 28px; font-weight: 590;">${groupedNotifications.mentions.length}</div>
          <div style="font-size: 12px; color: #666;">Mentions</div>
        </td>
      `;
    }

    if (groupedNotifications.others.length > 0) {
      statsHTML += `
        <td align="center" valign="middle" style="padding: 10px;">
          <div style="font-size: 28px; font-weight: 590;">${groupedNotifications.others.length}</div>
          <div style="font-size: 12px; color: #666;">Others</div>
        </td>
      `;
    }

    if (statsHTML) {
      return `
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom: 1px solid #c2c2c2;">
          <tr>
            <td style="padding: 35px 0 20px 0;">
              <div style="font-size: 18px; font-weight: 590; margin-bottom: 20px;">
                📊 Today's Summary
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${statsHTML}
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `;
    }

    return "";
  };

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        /* Define the font-face */
        @font-face {
          font-family: "SF Pro Text";
          src: url("https://thesubset.org/assets/fonts/SF-Pro-Text-Regular.otf")
            format("opentype");
          font-weight: 400;
          font-style: normal;
        }

        @font-face {
          font-family: "SF Pro Text";
          src: url("https://thesubset.org/assets/fonts/SF-Pro-Text-Semibold.otf")
            format("opentype");
          font-weight: 590;
          font-style: normal;
        }

        @font-face {
          font-family: "SF Pro Text";
          src: url("https://thesubset.org/assets/fonts/SF-Pro-Text-RegularItalic.otf")
            format("opentype");
          font-weight: 400;
          font-style: italic;
        }

        /* Apply the font to all elements */
        body {
          font-family: "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI",
            Roboto, sans-serif;
          margin: 0;
          padding: 0;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          background-color: #ffffff;
        }
          .container-table{
          padding-left: 20rem;
          padding-right: 20rem;
          padding-bottom: 20rem;
          }
           @media only screen and (max-width: 600px) {
          .container-table {
            width: 100% !important;
            padding-left: 1rem;
            padding-right: 1rem;
            padding-bottom: 1rem;
          }
          .main-title {
            font-size: 28px !important;
          }
          .section-title {
            font-size: 20px !important;
          }
               .button-container {
      padding: 30px 0 !important;
    }
    .button-table {
      width: 100% !important;
    }
    .button-cell {
      width: 100% !important;
      display: block !important;
    }
    .button-link {
      width: 90% !important;
      max-width: 280px !important;
      padding: 16px 0 !important;
      display: block !important;
      margin: 0 auto !important;
      text-align: center !important;

    }
    .button-text {
      font-size: 15px !important;
      line-height: 1.4 !important;
      padding: 0 20px !important;
      display: block !important;
    }
        }
        
      
      </style>
    </head>
    <body style="background:#f4f4f4;">
      <!-- Main Container Table -->
      <table 
        width="90%" 
        cellpadding="0" 
        cellspacing="0" 
        border="0" 
        align="center"
        style="
          margin-top: 75px;
          background: #f4f4f4;
          
        "
        class="container-table"
      >
        <!-- Logo Section -->
        <tr>
          <td align="center" style="padding-top: 100px; padding-bottom: 50px;">
            <img
              src="https://thesubset.org/assets/SUB•SET.png"
              alt="SUB•SET"
              style="display: block;"
              width="75"
              height:"25"
            />
          </td>
        </tr>
        
        <!-- Main Title -->
        <tr>
          <td 
            style="
              font-size: 28px;
              border-bottom: 1px solid black;
              padding-bottom: 50px;
              font-weight: 500;
              text-align: center;
            "
            class="main-title"
          >
            📢 Hey ${
              username.split(" ")[0]
            }, here's your SUB•SET Connect activity
          </td>
        </tr>
      
        <!-- Messages Section -->
        ${
          groupedNotifications.messages.length > 0
            ? `
          <tr>
            <td style="padding-top: 25px;">
              <div style="font-size: 24px; font-weight: 500">
                💬 Messages
              </div>
            </td>
          </tr>
          <tr>
            <td>
              ${generateNotificationItems(
                groupedNotifications.messages,
                "messages"
              )}
            </td>
          </tr>
          <tr>
            <td style="border-bottom: 1px solid black; padding-bottom: 10px;"></td>
          </tr>
        `
            : ""
        }

        <!-- Replies Section -->
        ${
          groupedNotifications.replies.length > 0
            ? `
          <tr>
            <td style="padding-top: 25px;">
              <div style="font-size: 24px; font-weight: 500">
                ↩️ Replies
              </div>
            </td>
          </tr>
          <tr>
            <td>
              ${generateNotificationItems(
                groupedNotifications.replies,
                "replies"
              )}
            </td>
          </tr>
          <tr>
            <td style="border-bottom: 1px solid black; padding-bottom: 10px;"></td>
          </tr>
        `
            : ""
        }

        <!-- Likes Section -->
        ${
          groupedNotifications.likes.length > 0
            ? `
          <tr>
            <td style="padding-top: 25px;">
              <div style="font-size: 24px; font-weight: 500">
                🖤 Likes
              </div>
            </td>
          </tr>
          <tr>
            <td>
              ${generateNotificationItems(groupedNotifications.likes, "likes")}
            </td>
          </tr>
          <tr>
            <td style="border-bottom: 1px solid black; padding-bottom: 10px;"></td>
          </tr>
        `
            : ""
        }

        <!-- Mentions Section -->
        ${
          groupedNotifications.mentions.length > 0
            ? `
          <tr>
            <td style="padding-top: 25px;">
              <div style="font-size: 24px; font-weight: 500">
                👥 Mentions
              </div>
            </td>
          </tr>
          <tr>
            <td>
              ${generateNotificationItems(
                groupedNotifications.mentions,
                "mentions"
              )}
            </td>
          </tr>
          <tr>
            <td style="border-bottom: 1px solid black; padding-bottom: 10px;"></td>
          </tr>
        `
            : ""
        }

        <!-- Other Notifications Section -->
        ${
          groupedNotifications.others.length > 0
            ? `
          <tr>
            <td style="padding-top: 25px;">
              <div style="font-size: 24px; font-weight: 500">
                📢 Others
              </div>
            </td>
          </tr>
          <tr>
            <td>
              ${generateNotificationItems(
                groupedNotifications.others,
                "others"
              )}
            </td>
          </tr>
          <tr>
            <td style="border-bottom: 1px solid black; padding-bottom: 10px;"></td>
          </tr>
        `
            : ""
        }

        <!-- CTA Button -->
        <tr>
  <td align="center" class="button-container" style="padding: 50px 0;">
    <table border="0" cellpadding="0" cellspacing="0" class="button-table" style="border-collapse: separate; mso-table-lspace: 0pt; mso-table-rspace: 0pt; width: auto;">
      <tr>
        <td class="button-cell" style="
          font-family: 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 16px;
          vertical-align: top;
          background-color: #000000;
          border-radius: 40px;
          text-align: center;
        ">
          <a href="https://thesubset.org/notifications" 
            target="_blank" 
            class="button-link"
            style="
              display: inline-block;
              color: #ffffff;
              background-color: #000000;
              border: solid 1px #000000;
              border-radius: 40px;
              box-sizing: border-box;
              cursor: pointer;
              text-decoration: none;
              font-size: 16px;
              font-weight: 590;
              margin: 0;
              padding: 18px 40px;
              text-transform: none;
              mso-padding-alt: 0px;
            ">
            <span class="button-text">Review All Notifications</span>
          </a>
        </td>
      </tr>
    </table>
  </td>
</tr>
        
        <!-- Footer -->
       <!-- Footer -->
<tr>
  <td align="center" style="padding-top: 30px; padding-bottom: 10px;">
    <div style="color: #cacaca; font-size: 14px;">
      © SUB•SET ${new Date().getFullYear()}
    </div>
  </td>
</tr>

<tr>
  <td align="center" style="padding-bottom: 50px;">
    <a
      href="https://thesubset.org/notifications"
      target="_blank"
      style="
        text-decoration: none;
        color: #cacaca;
        font-size: 13px;
        font-weight: 500;
      "
    >
      Unsubscribe
    </a>
  </td>
</tr>

      </table>
    </body>
    </html>
  `;
};
