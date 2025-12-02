// export interface user {
//   _id: string;
//   email: string;
//   emailVerified: boolean;
//   name?: string;
//   avatarUrl?: string;
//   roles: string;
//   createdAt: Date;
//   updatedAt: Date;
// }

export type User = {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image?: string | null;
  role: "user" | "admin";
  createdAt: Date;
  updatedAt: Date;
};
