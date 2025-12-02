import Joi from "joi";

export const updateUserProfileSchema = Joi.object({
  firstName: Joi.string().trim().min(2).max(50),
  lastName: Joi.string().trim().min(2).max(50),
  phoneNumber: Joi.string()
    .pattern(/^[0-9]{10,15}$/)
    .allow(""),
  jobTitle: Joi.string().trim().max(100).allow(""),
  companyName: Joi.string().trim().max(100).allow(""),
  designation: Joi.string().trim().max(100).allow(""),
  timezone: Joi.string().trim(),
  profileImage: Joi.string().uri().allow(""), // optional, must be a valid URL if provided
});
