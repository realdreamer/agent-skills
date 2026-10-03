import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';

type Context = { params: Promise<{ id: string }> };

async function loadOwnedOrder(id: string) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const order = await db.order.findUnique({ where: { id } });
  // Another user's order answers 404, not 403, so order ids can't be probed.
  if (!order || (order.userId !== session.userId && session.role !== 'admin')) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  return { order };
}

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const { order, error } = await loadOwnedOrder(id);
  if (error) return error;

  return NextResponse.json({
    id: order.id,
    status: order.status,
    totalCents: order.totalCents,
    items: order.items,
  });
}

export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  const { order, error } = await loadOwnedOrder(id);
  if (error) return error;

  if (order.status !== 'pending') {
    return NextResponse.json({ error: 'Only pending orders can be cancelled' }, { status: 409 });
  }
  await db.order.update({ where: { id }, data: { status: 'cancelled' } });
  return new NextResponse(null, { status: 204 });
}
