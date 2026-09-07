import { Job } from "../../model/job.js";
import { User } from "../../model/user.js";
import { sendEmail } from "../../utils/sendEmail.js";

export const toggleSavedJobs = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user._id;

    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    const isAlreadySaved = job.savedByUsers?.some(
      (id) => (id?._id || id)?.toString() === userId.toString(),
    );

    if (isAlreadySaved) {
      await Job.findByIdAndUpdate(jobId, { $pull: { savedByUsers: userId } });
      await User.findByIdAndUpdate(userId, { $pull: { savedJobs: jobId } });
      return res.status(200).json({ message: "Job removed from saved" });
    }

    await Job.findByIdAndUpdate(jobId, { $addToSet: { savedByUsers: userId } });
    await User.findByIdAndUpdate(userId, { $addToSet: { savedJobs: jobId } });
    return res.status(200).json({ message: "Job saved successfully" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const toggleConnection = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user._id;

    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    if (!job.allowInternalConnections) {
      return res.status(400).json({
        message: "Internal connections are not enabled for this job post",
      });
    }

    const isConnected = job.connections?.some(
      (id) => (id?._id || id)?.toString() === userId.toString(),
    );

    if (isConnected) {
      await Job.findByIdAndUpdate(jobId, { $pull: { connections: userId } });
      return res.status(200).json({ message: "Removed from connections" });
    }

    await Job.findByIdAndUpdate(jobId, { $addToSet: { connections: userId } });
    return res.status(200).json({ message: "Added to connections successfully" });
  } catch (error) {
    console.error("Error toggling connection:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const submitJobPost = async (req, res) => {
  try {
    const {
      companyName,
      aboutCompany,
      website,
      instagram,
      linkedin,
      companySize,
      visualAssets,
      jobTitle,
      jobCategory,
      jobCategories,
      applicationLink,
      location,
      workplaceType,
      contractType,
      salaryRange,
      currency,
      overview,
      listingDuration,
      allowInternalConnections,
      submitterName,
      submitterEmail,
    } = req.body;

    if (!companyName || !companyName.trim()) {
      return res.status(400).json({ message: "Company or Studio name is required." });
    }
    if (!jobTitle || !jobTitle.trim()) {
      return res.status(400).json({ message: "Job title is required." });
    }

    const finalCategories = Array.isArray(jobCategories)
      ? jobCategories.filter(Boolean)
      : jobCategory
      ? [jobCategory]
      : [];

    if (!finalCategories.length && !jobCategory) {
      return res.status(400).json({ message: "Job category is required." });
    }

    const primaryCategory = finalCategories[0] || jobCategory || null;

    const cleanRichText = (str) => {
      if (!str) return "";
      return String(str)
        .replace(/&amp;nbsp;/gi, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/\u00A0/g, " ")
        .replace(/\u200B/g, "")
        .replace(/\u00AD/g, "");
    };

    const newJob = await Job.create({
      companyName: companyName.trim(),
      aboutCompany: cleanRichText(aboutCompany).trim(),
      website: website?.trim() || "",
      instagram: instagram?.trim() || "",
      linkedin: linkedin?.trim() || "",
      companySize: companySize?.trim() || "",
      visualAssets: Array.isArray(visualAssets) ? visualAssets : [],
      jobTitle: jobTitle.trim(),
      jobCategory: primaryCategory,
      jobCategories: finalCategories,
      applicationLink: applicationLink?.trim() || "",
      location: location?.trim() || "",
      workplaceType: workplaceType || "On-site",
      contractType: contractType || "Full-time",
      salaryRange: salaryRange?.trim() || "",
      currency: currency || "$",
      overview: cleanRichText(overview).trim(),
      listingDuration: listingDuration || "30 Days",
      allowInternalConnections: Boolean(allowInternalConnections),
      status: "pending",
      submitterName:
        req.user?.fullName ||
        (req.user?.firstName
          ? `${req.user.firstName} ${req.user.lastName || ""}`.trim()
          : "") ||
        req.user?.username ||
        submitterName?.trim() ||
        "",
      submitterEmail: req.user?.email || submitterEmail?.trim() || "",
      postedBy: req.user?._id || null,
    });

    const populatedJob = await Job.findById(newJob._id)
      .populate("jobCategory", "name position")
      .populate("jobCategories", "name position");

    return res.status(201).json({
      success: true,
      message: "Job post submitted successfully and is pending review.",
      data: populatedJob,
    });
  } catch (error) {
    console.error("Error submitting job post:", error);
    return res
      .status(500)
      .json({ message: error.message || "Internal Server Error" });
  }
};

export const SubmitJob = submitJobPost;

export const UpdateUserJob = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id;

    const job = await Job.findById(id);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    // Check ownership
    const isOwner =
      (job.postedBy && job.postedBy.toString() === userId?.toString()) ||
      (job.submitterEmail &&
        req.user?.email &&
        job.submitterEmail.toLowerCase() === req.user.email.toLowerCase());

    if (!isOwner) {
      return res.status(403).json({
        message: "You are not authorized to edit this job post.",
      });
    }

    // User cannot edit while job is already pending review
    if (job.status === "pending") {
      return res.status(400).json({
        message:
          "This job post is currently under review and cannot be edited until reviewed by an admin.",
      });
    }

    // User cannot edit if job was rejected
    if (job.status === "rejected") {
      return res.status(400).json({
        message: "This job post has been rejected and cannot be edited.",
      });
    }

    const {
      companyName,
      aboutCompany,
      website,
      instagram,
      linkedin,
      companySize,
      visualAssets,
      jobTitle,
      jobCategory,
      jobCategories,
      applicationLink,
      location,
      workplaceType,
      contractType,
      salaryRange,
      currency,
      overview,
      listingDuration,
      allowInternalConnections,
    } = req.body;

    const cleanRichText = (str) => {
      if (!str) return "";
      return String(str)
        .replace(/&amp;nbsp;/gi, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/\u00A0/g, " ")
        .replace(/\u200B/g, "")
        .replace(/\u00AD/g, "");
    };

    // Calculate which fields actually changed with previous and new values
    const modifiedFields = [];
    const editedFieldChanges = [];

    const recordChange = (fieldName, oldVal, newVal) => {
      modifiedFields.push(fieldName);
      editedFieldChanges.push({
        field: fieldName,
        oldValue:
          oldVal !== undefined && oldVal !== null && String(oldVal).trim() !== ""
            ? String(oldVal).trim()
            : "None",
        newValue:
          newVal !== undefined && newVal !== null && String(newVal).trim() !== ""
            ? String(newVal).trim()
            : "None",
      });
    };

    if (
      companyName !== undefined &&
      companyName.trim() !== (job.companyName || "")
    ) {
      recordChange(
        "Studio / Organization Name",
        job.companyName,
        companyName.trim(),
      );
    }

    if (
      aboutCompany !== undefined &&
      cleanRichText(aboutCompany).trim() !==
        cleanRichText(job.aboutCompany || "").trim()
    ) {
      recordChange(
        "About Organization",
        cleanRichText(job.aboutCompany),
        cleanRichText(aboutCompany),
      );
    }

    if (
      website !== undefined &&
      (website.trim() || "") !== (job.website || "")
    ) {
      recordChange("Website URL", job.website, website.trim());
    }

    if (
      instagram !== undefined &&
      (instagram.trim() || "") !== (job.instagram || "")
    ) {
      recordChange("Instagram", job.instagram, instagram.trim());
    }

    if (
      linkedin !== undefined &&
      (linkedin.trim() || "") !== (job.linkedin || "")
    ) {
      recordChange("LinkedIn", job.linkedin, linkedin.trim());
    }

    if (
      companySize !== undefined &&
      (companySize.trim() || "") !== (job.companySize || "")
    ) {
      recordChange("Studio Size", job.companySize, companySize.trim());
    }

    if (visualAssets !== undefined) {
      const oldAssets = job.visualAssets || [];
      const newAssets = visualAssets || [];
      if (JSON.stringify(oldAssets) !== JSON.stringify(newAssets)) {
        recordChange(
          "Visual Assets",
          `${oldAssets.length} image(s)`,
          `${newAssets.length} image(s)`,
        );
      }
    }

    if (jobTitle !== undefined && jobTitle.trim() !== (job.jobTitle || "")) {
      recordChange("Job Title", job.jobTitle, jobTitle.trim());
    }

    if (jobCategories !== undefined || jobCategory !== undefined) {
      const incomingCats = Array.isArray(jobCategories)
        ? jobCategories.map(String)
        : jobCategory
        ? [String(jobCategory)]
        : [];
      const existingCats = (job.jobCategories || []).map((c) =>
        String(c?._id || c),
      );
      if (
        JSON.stringify(incomingCats.sort()) !==
        JSON.stringify(existingCats.sort())
      ) {
        recordChange(
          "Job Categories",
          `${existingCats.length} category(ies)`,
          `${incomingCats.length} category(ies)`,
        );
      }
    }

    if (
      applicationLink !== undefined &&
      (applicationLink.trim() || "") !== (job.applicationLink || "")
    ) {
      recordChange(
        "Application Link / Email",
        job.applicationLink,
        applicationLink.trim(),
      );
    }

    if (
      location !== undefined &&
      (location.trim() || "") !== (job.location || "")
    ) {
      recordChange("Location", job.location, location.trim());
    }

    if (workplaceType !== undefined && workplaceType !== job.workplaceType) {
      recordChange("Workplace Type", job.workplaceType, workplaceType);
    }

    if (contractType !== undefined && contractType !== job.contractType) {
      recordChange("Contract Type", job.contractType, contractType);
    }

    // Salary & Currency change tracking
    const oldSalaryStr = job.salaryRange
      ? `${job.currency || "$"} ${job.salaryRange}`
      : "Not specified";
    const newSalaryRaw =
      salaryRange !== undefined ? salaryRange.trim() : job.salaryRange || "";
    const newCurrRaw = currency || job.currency || "$";
    const newSalaryStr = newSalaryRaw
      ? `${newCurrRaw} ${newSalaryRaw}`
      : "Not specified";

    if (
      (salaryRange !== undefined &&
        (salaryRange.trim() || "") !== (job.salaryRange || "")) ||
      (currency !== undefined && currency !== job.currency && newSalaryRaw)
    ) {
      recordChange("Salary Range", oldSalaryStr, newSalaryStr);
    }

    if (
      overview !== undefined &&
      cleanRichText(overview).trim() !== cleanRichText(job.overview || "").trim()
    ) {
      recordChange(
        "Role Overview & Responsibilities",
        cleanRichText(job.overview),
        cleanRichText(overview),
      );
    }

    if (
      listingDuration !== undefined &&
      listingDuration !== job.listingDuration
    ) {
      recordChange(
        "Listing Duration",
        job.listingDuration || "30 Days",
        listingDuration,
      );
    }

    if (
      allowInternalConnections !== undefined &&
      Boolean(allowInternalConnections) !==
        Boolean(job.allowInternalConnections)
    ) {
      recordChange(
        "Internal Connections Feature",
        job.allowInternalConnections ? "Enabled" : "Disabled",
        allowInternalConnections ? "Enabled" : "Disabled",
      );
    }

    const finalCategories = Array.isArray(jobCategories)
      ? jobCategories.filter(Boolean)
      : jobCategory
      ? [jobCategory]
      : job.jobCategories;

    const primaryCategory =
      finalCategories[0] || jobCategory || job.jobCategory;

    // Update job document
    job.companyName =
      companyName !== undefined ? companyName.trim() : job.companyName;
    job.aboutCompany =
      aboutCompany !== undefined
        ? cleanRichText(aboutCompany).trim()
        : job.aboutCompany;
    job.website = website !== undefined ? website.trim() : job.website;
    job.instagram =
      instagram !== undefined ? instagram.trim() : job.instagram;
    job.linkedin = linkedin !== undefined ? linkedin.trim() : job.linkedin;
    job.companySize =
      companySize !== undefined ? companySize.trim() : job.companySize;
    if (visualAssets !== undefined) job.visualAssets = visualAssets;
    job.jobTitle = jobTitle !== undefined ? jobTitle.trim() : job.jobTitle;
    job.jobCategory = primaryCategory;
    job.jobCategories = finalCategories;
    job.applicationLink =
      applicationLink !== undefined
        ? applicationLink.trim()
        : job.applicationLink;
    job.location = location !== undefined ? location.trim() : job.location;
    job.workplaceType = workplaceType || job.workplaceType;
    job.contractType = contractType || job.contractType;
    job.salaryRange =
      salaryRange !== undefined ? salaryRange.trim() : job.salaryRange;
    job.currency = currency || job.currency;
    job.overview =
      overview !== undefined ? cleanRichText(overview).trim() : job.overview;
    job.listingDuration = listingDuration || job.listingDuration;
    if (allowInternalConnections !== undefined) {
      job.allowInternalConnections = Boolean(allowInternalConnections);
    }

    // Set moderation status & edit tracking flags
    job.status = "pending";
    job.isEdited = true;
    job.editedFields =
      modifiedFields.length > 0 ? modifiedFields : ["Job Details"];
    job.editedFieldChanges = editedFieldChanges;
    job.lastEditedAt = new Date();

    await job.save();

    const populatedJob = await Job.findById(job._id)
      .populate("jobCategory", "name position")
      .populate("jobCategories", "name position")
      .populate("postedBy", "fullName username email");

    // Send email alert to admin
    // try {
    //   const adminEmail = process.env.ADMIN_EMAIL || "contact@thesubset.org";
    //   const userDisplay =
    //     req.user?.fullName ||
    //     req.user?.username ||
    //     req.user?.email ||
    //     "A user";

    //   const diffTableHtml =
    //     editedFieldChanges.length > 0
    //       ? `
    //       <table border="1" cellpadding="8" style="border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 13px; font-family: Arial, sans-serif; border: 1px solid #e0e0e0;">
    //         <thead>
    //           <tr style="background-color: #f3f4f6; color: #111;">
    //             <th style="text-align: left; padding: 10px; border: 1px solid #e5e7eb;">Field</th>
    //             <th style="text-align: left; padding: 10px; border: 1px solid #e5e7eb;">Previous Value</th>
    //             <th style="text-align: left; padding: 10px; border: 1px solid #e5e7eb;">New Requested Value</th>
    //           </tr>
    //         </thead>
    //         <tbody>
    //           ${editedFieldChanges
    //             .map(
    //               (c) => `
    //             <tr>
    //               <td style="padding: 10px; font-weight: 700; border: 1px solid #e5e7eb;">${c.field}</td>
    //               <td style="padding: 10px; color: #991b1b; background-color: #fef2f2; border: 1px solid #e5e7eb;">${c.oldValue || "—"}</td>
    //               <td style="padding: 10px; color: #166534; background-color: #f0fdf4; font-weight: 600; border: 1px solid #e5e7eb;">${c.newValue || "—"}</td>
    //             </tr>
    //           `,
    //             )
    //             .join("")}
    //         </tbody>
    //       </table>
    //     `
    //       : `<p>Job details updated</p>`;

    //   const emailHtml = `
    //     <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; color: #111; line-height: 1.5;">
    //       <h2 style="margin-bottom: 8px;">Job Post Edited — Pending Admin Approval</h2>
    //       <p><strong>${userDisplay}</strong> (${req.user?.email || ""}) has submitted edits for the job listing:</p>
    //       <div style="padding: 14px 18px; background-color: #f9fafb; border-radius: 8px; margin: 16px 0; border: 1px solid #e5e7eb;">
    //         <p style="margin: 4px 0;"><strong>Studio / Company:</strong> ${job.companyName}</p>
    //         <p style="margin: 4px 0;"><strong>Job Title:</strong> ${job.jobTitle}</p>
    //         <p style="margin: 4px 0;"><strong>Location:</strong> ${job.location || "Remote"}</p>
    //       </div>
    //       <h3 style="margin-bottom: 6px;">Field Changes (Previous vs Requested):</h3>
    //       ${diffTableHtml}
    //       <p style="margin-top: 24px; color: #555; font-size: 13px;">Please log in to the Subset admin dashboard to review and approve these changes.</p>
    //     </div>
    //   `;

    //   await sendEmail(
    //     adminEmail,
    //     `📝 Job Edited: ${job.companyName} - ${job.jobTitle}`,
    //     emailHtml,
    //   );
    // } catch (emailErr) {
    //   console.error(
    //     "Error sending admin job edit notification email:",
    //     emailErr,
    //   );
    // }

    return res.status(200).json({
      success: true,
      message: "Job post updated successfully and submitted for admin review.",
      data: populatedJob,
    });
  } catch (error) {
    console.error("Error updating user job:", error);
    return res
      .status(500)
      .json({ message: error.message || "Internal Server Error" });
  }
};
