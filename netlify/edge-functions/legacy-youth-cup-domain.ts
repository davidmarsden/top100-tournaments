export default async (request: Request, context: any) => {
  const url = new URL(request.url);

  if (url.hostname !== 'youth-cup.smtop100.blog') {
    return context.next();
  }

  url.hostname = 'tournaments.smtop100.blog';
  return Response.redirect(url.toString(), 301);
};

export const config = {
  path: '/*',
  excludedPath: '/.netlify/functions/*',
};
