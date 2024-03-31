export type M = {
  Group: {
    id: string;
    name: string;
  };
  Author: {
    id: string;
    name: string;
    groupId: string | null;
  };
  Post: {
    id: string;
    title: string;
    body: string;
    authorId: string;
  };
  Tag: {
    id: string;
    name: string;
  };
  PostTag: {
    id: string;
    postId: string;
    tagId: string;
  };
  PostTagAnnotation: {
    id: string;
    postId: string;
    tagId: string;
    annotation: string;
  };
};
